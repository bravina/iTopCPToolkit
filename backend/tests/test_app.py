# backend/tests/test_app.py
#
# Flask routes.  The schema comes from whichever factory is importable (fake on
# CI, real inside Docker); the catalogue/examples come from the tct_data_dir
# fixture.  Only response shapes are asserted, never Athena block lists.

import json

import pytest

import catalogue
import introspect


@pytest.fixture
def flask_app(tct_data_dir, monkeypatch):
    monkeypatch.setattr(catalogue, "find_tct_data_dir", lambda: str(tct_data_dir))
    import app as flask_app
    flask_app.app.config["TESTING"] = True
    flask_app.reset_schema_cache()
    yield flask_app
    flask_app.reset_schema_cache()


@pytest.fixture
def client(flask_app):
    with flask_app.app.test_client() as c:
        yield c


class TestHealth:

    def test_shape(self, client):
        data = client.get("/api/health").get_json()
        assert data["status"] == "ok"
        assert set(data) >= {"athena", "app_version", "ab_version", "tct_version",
                             "pdflatex", "schema_source"}
        assert data["app_version"]
        assert data["schema_source"] == "athena"


class TestSchema:

    def test_shape(self, client):
        r = client.get("/api/schema")
        assert r.status_code == 200
        data = r.get_json()
        assert set(data) >= {"categories", "blocks", "catalogue", "examples", "keywords",
                             "versions", "source", "snapshotVersions"}
        assert data["source"] == "athena"
        assert data["blocks"] and isinstance(data["blocks"], list)
        for b in data["blocks"]:
            assert set(b) >= {"name", "factoryName", "kind", "category", "label", "classes",
                              "options", "dependencies", "subBlocks", "parents", "error"}
            for o in b["options"]:
                assert set(o) >= {"name", "type", "default", "factoryDefault", "info", "required",
                                  "noneAction", "expertMode", "physicalUnit", "generic",
                                  "origin", "meta"}

    def test_catalogue_and_examples_included(self, client):
        data = client.get("/api/schema").get_json()
        names = [e["algName"] for e in data["catalogue"]]
        assert names == ["Missing", "Tutorial", "TutorialGroup"]
        tut = next(e for e in data["catalogue"] if e["algName"] == "Tutorial")
        assert tut["block"]["error"] is None
        assert tut["usedIn"] == ["a.yaml", "sub/b.yaml"]
        assert [e["path"] for e in data["examples"]] == ["a.yaml", "broken.yaml", "sub/b.yaml"]
        assert "content" not in data["examples"][0]

    def test_etag_roundtrip(self, client):
        r = client.get("/api/schema")
        etag = r.headers["ETag"]
        assert etag
        r2 = client.get("/api/schema", headers={"If-None-Match": etag})
        assert r2.status_code == 304


class TestIntrospect:

    def _post(self, client, payload):
        return client.post("/api/introspect", data=json.dumps(payload),
                           content_type="application/json")

    def test_success(self, client):
        r = self._post(client, {"modulePath": "FakeAlgorithms.FakeConfig",
                                "functionName": "TutorialConfig", "algName": "MyTutorial",
                                "pos": "Output"})
        assert r.status_code == 200, r.get_json()
        data = r.get_json()
        assert data["entry"]["algName"] == "MyTutorial"
        assert data["entry"]["pos"] == "Output"
        assert data["block"]["name"] == "MyTutorial"
        assert any(o["name"] == "tutorialOption" for o in data["block"]["options"])

    def test_missing_fields(self, client):
        r = self._post(client, {"modulePath": "x"})
        assert r.status_code == 400
        assert "functionName" in r.get_json()["error"]

    def test_bad_module(self, client):
        r = self._post(client, {"modulePath": "NoSuchModule.X", "functionName": "Y", "algName": "Z"})
        assert r.status_code == 400
        assert "NoSuchModule" in r.get_json()["error"]

    def test_unavailable_without_athena(self, client, monkeypatch):
        monkeypatch.setattr(introspect, "athena_available", lambda: False)
        r = self._post(client, {"modulePath": "a", "functionName": "b", "algName": "c"})
        assert r.status_code == 503


class TestExamples:

    def test_list(self, client):
        assert [e["path"] for e in client.get("/api/examples").get_json()] == \
            ["a.yaml", "broken.yaml", "sub/b.yaml"]

    def test_content(self, client):
        r = client.get("/api/examples/sub/b.yaml")
        assert r.status_code == 200
        assert "yaml" in r.content_type
        assert "tutorialOption: 5" in r.get_data(as_text=True)

    def test_unknown_and_traversal(self, client):
        assert client.get("/api/examples/nope.yaml").status_code == 404
        assert client.get("/api/examples/../notes.txt").status_code == 404


class TestSnapshotFallback:

    def test_snapshot_served_without_athena(self, flask_app, tmp_path, monkeypatch):
        snapshot = {
            "categories": ["Core"], "keywords": None, "catalogue": [],
            "versions": {"ab": "25.2.999", "tct": "v9.9.9"},
            "blocks": [{"name": "Snap", "factoryName": "Snap", "kind": "class", "category": "Core",
                        "label": "Snap", "classes": [], "options": [], "dependencies": [],
                        "subBlocks": [], "parents": [], "error": None}],
            "examples": [{"path": "x.yaml", "name": "x", "content": "Snap: {}\n"}],
        }
        path = tmp_path / "snap.json"
        path.write_text(json.dumps(snapshot))
        monkeypatch.setattr(introspect, "athena_available", lambda: False)
        monkeypatch.setattr(flask_app, "SNAPSHOT_PATH", str(path))
        flask_app.reset_schema_cache()
        with flask_app.app.test_client() as c:
            data = c.get("/api/schema").get_json()
            assert data["source"] == "snapshot"
            assert data["snapshotVersions"]["ab"] == "25.2.999"
            assert data["versions"]["athena"] is False
            assert [b["name"] for b in data["blocks"]] == ["Snap"]
            assert c.get("/api/health").get_json()["schema_source"] == "snapshot"
            r = c.get("/api/examples/x.yaml")
            assert r.status_code == 200 and r.get_data(as_text=True) == "Snap: {}\n"

    def test_empty_schema_without_snapshot(self, flask_app, tmp_path, monkeypatch):
        monkeypatch.setattr(introspect, "athena_available", lambda: False)
        monkeypatch.setattr(flask_app, "SNAPSHOT_PATH", str(tmp_path / "absent.json"))
        flask_app.reset_schema_cache()
        with flask_app.app.test_client() as c:
            data = c.get("/api/schema").get_json()
            assert data["source"] == "none"
            assert data["blocks"] == [] and data["catalogue"] == []


def test_export_yaml_removed(client):
    r = client.post("/api/export-yaml", data="{}", content_type="application/json")
    assert r.status_code in (404, 405)

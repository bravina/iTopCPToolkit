# backend/tests/test_app.py
#
# Tests for the Flask routes in app.py.
#
# The Athena introspection layer (get_options) is mocked to return a fixed
# schema, so these tests run anywhere without Docker.
#
# What is tested:
#   - /api/health  returns the right shape
#   - /api/schema  returns a list whose entries match BLOCK_TREE
#   - /api/export-yaml  returns valid YAML containing the submitted config

import json
import pytest
import yaml
from unittest.mock import patch

# Adjust path so we can import app from the backend directory
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


# Mock get_options to return a minimal option list — avoids needing Athena
MOCK_OPTIONS = [
    {"name": "containerName", "type": "str", "default": "AnaJets",
     "info": "The container name", "required": False, "noneAction": "ignore"},
]

@pytest.fixture()
def client():
    """Return a Flask test client with a pre-built schema cache."""
    with patch("introspect.get_options", return_value=MOCK_OPTIONS):
        import app as flask_app
        flask_app.app.config["TESTING"] = True
        # Force schema rebuild with the mock in place
        flask_app._schema_cache = None
        with flask_app.app.test_client() as c:
            # Trigger the schema build
            c.get("/api/schema")
            yield c


# ─────────────────────────────────────────────────────────────────────────────
# /api/health
# ─────────────────────────────────────────────────────────────────────────────

class TestHealth:

    def test_returns_200(self, client):
        r = client.get("/api/health")
        assert r.status_code == 200

    def test_contains_status_ok(self, client):
        data = r = client.get("/api/health").get_json()
        assert data["status"] == "ok"

    def test_contains_app_version(self, client):
        data = client.get("/api/health").get_json()
        assert "app_version" in data
        assert data["app_version"]  # non-empty

    def test_contains_athena_key(self, client):
        data = client.get("/api/health").get_json()
        assert "athena" in data


# ─────────────────────────────────────────────────────────────────────────────
# /api/schema
# ─────────────────────────────────────────────────────────────────────────────

class TestSchema:
    from block_schema import BLOCK_TREE as _BLOCK_TREE

    def test_returns_200(self, client):
        assert client.get("/api/schema").status_code == 200

    def test_returns_list(self, client):
        data = client.get("/api/schema").get_json()
        assert isinstance(data, list)

    def test_length_matches_block_tree(self, client):
        from block_schema import BLOCK_TREE
        data = client.get("/api/schema").get_json()
        assert len(data) == len(BLOCK_TREE)

    def test_each_entry_has_required_fields(self, client):
        data = client.get("/api/schema").get_json()
        for block in data:
            assert "name"        in block
            assert "label"       in block
            assert "options"     in block
            assert "sub_blocks"  in block
            assert isinstance(block["options"],    list)
            assert isinstance(block["sub_blocks"], list)

    def test_options_have_required_fields(self, client):
        data = client.get("/api/schema").get_json()
        for block in data:
            for opt in block["options"]:
                assert "name"       in opt
                assert "type"       in opt
                assert "default"    in opt
                assert "info"       in opt
                assert "required"   in opt
                assert "noneAction" in opt

    def test_block_names_match_block_tree(self, client):
        from block_schema import BLOCK_TREE
        schema_names = {b["name"] for b in client.get("/api/schema").get_json()}
        tree_names   = {b["name"] for b in BLOCK_TREE}
        assert schema_names == tree_names


# ─────────────────────────────────────────────────────────────────────────────
# /api/export-yaml
# ─────────────────────────────────────────────────────────────────────────────

class TestExportYaml:

    def _post(self, client, config, filename="out.yaml"):
        return client.post(
            "/api/export-yaml",
            data=json.dumps({"config": config, "filename": filename}),
            content_type="application/json",
        )

    def test_returns_200(self, client):
        assert self._post(client, {"Jets": [{"containerName": "AnaJets"}]}).status_code == 200

    def test_content_type_is_yaml(self, client):
        r = self._post(client, {"Jets": [{"containerName": "AnaJets"}]})
        assert "yaml" in r.content_type

    def test_output_is_valid_yaml(self, client):
        r = self._post(client, {"Jets": [{"containerName": "AnaJets"}]})
        parsed = yaml.safe_load(r.data)
        assert parsed is not None

    def test_output_contains_submitted_key(self, client):
        r = self._post(client, {"Jets": [{"containerName": "AnaJets"}]})
        parsed = yaml.safe_load(r.data)
        assert "Jets" in parsed

    def test_empty_config_is_valid_yaml(self, client):
        r = self._post(client, {})
        assert r.status_code == 200
        # Should not raise
        yaml.safe_load(r.data)

    def test_content_disposition_uses_filename(self, client):
        r = self._post(client, {}, filename="my_config.yaml")
        assert "my_config.yaml" in r.headers.get("Content-Disposition", "")

# backend/tests/test_ai_access.py
#
# The AI assistant's soft-launch gate.  Nothing here needs Athena — the gate is
# a string comparison and a throttle — so this file also runs on its own:
#
#     PYTHONPATH=backend pytest backend/tests/test_ai_access.py --noconftest
#
# What is asserted is what the gate promises: it opens only for the configured
# password, it can never open when none is configured, it never says what the
# password is, and it makes guessing slow.

import pytest

import app as flask_app

PASSWORD = "correct horse battery staple"


@pytest.fixture
def client(monkeypatch):
    flask_app.app.config["TESTING"] = True
    monkeypatch.setattr(flask_app, "_AI_FAIL_DELAY_S", 0)   # no sleeping in tests
    flask_app.reset_ai_throttle()
    with flask_app.app.test_client() as c:
        yield c
    flask_app.reset_ai_throttle()


@pytest.fixture
def gated(monkeypatch):
    monkeypatch.setenv(flask_app.AI_PASSWORD_ENV, PASSWORD)


@pytest.fixture
def ungated(monkeypatch):
    monkeypatch.delenv(flask_app.AI_PASSWORD_ENV, raising=False)


class TestConfiguredProbe:

    def test_reports_a_gate_and_only_that(self, client, gated):
        r = client.get("/api/ai-access")
        assert r.status_code == 200
        assert r.get_json() == {"configured": True}
        assert PASSWORD not in r.get_data(as_text=True)

    def test_reports_no_gate_when_unset(self, client, ungated):
        assert client.get("/api/ai-access").get_json() == {"configured": False}

    def test_empty_string_is_no_gate(self, client, monkeypatch):
        monkeypatch.setenv(flask_app.AI_PASSWORD_ENV, "")
        assert client.get("/api/ai-access").get_json() == {"configured": False}


class TestAttempt:

    def test_correct_password_opens(self, client, gated):
        r = client.post("/api/ai-access", json={"password": PASSWORD})
        assert r.status_code == 200
        assert r.get_json() == {"ok": True}

    def test_wrong_password_is_refused_plainly(self, client, gated):
        r = client.post("/api/ai-access", json={"password": "hunter2"})
        assert r.status_code == 401
        body = r.get_json()
        assert body == {"error": "That password is not right."}
        # The refusal must not leak the value, nor how close the guess was.
        assert PASSWORD not in r.get_data(as_text=True)

    def test_near_miss_is_refused(self, client, gated):
        assert client.post("/api/ai-access", json={"password": PASSWORD[:-1]}).status_code == 401
        assert client.post("/api/ai-access", json={"password": PASSWORD + " "}).status_code == 401

    def test_non_ascii_password_compares_without_blowing_up(self, client, monkeypatch):
        monkeypatch.setenv(flask_app.AI_PASSWORD_ENV, "mot-de-passe-é")
        assert client.post("/api/ai-access", json={"password": "mot-de-passe-é"}).status_code == 200
        assert client.post("/api/ai-access", json={"password": "mot-de-passe-e"}).status_code == 401

    def test_missing_or_malformed_body_is_refused(self, client, gated):
        assert client.post("/api/ai-access", json={}).status_code == 401
        assert client.post("/api/ai-access", json={"password": None}).status_code == 401
        assert client.post("/api/ai-access", json={"password": ["x"]}).status_code == 401
        assert client.post("/api/ai-access", data="not json").status_code == 401

    def test_unconfigured_gate_can_never_open(self, client, ungated):
        for attempt in ("", PASSWORD, "anything at all"):
            assert client.post("/api/ai-access", json={"password": attempt}).status_code == 401

    def test_empty_configured_password_can_never_open(self, client, monkeypatch):
        monkeypatch.setenv(flask_app.AI_PASSWORD_ENV, "")
        assert client.post("/api/ai-access", json={"password": ""}).status_code == 401


class TestThrottle:

    def test_failures_are_capped_then_refused_outright(self, client, gated):
        for _ in range(flask_app._AI_FAIL_LIMIT):
            assert client.post("/api/ai-access", json={"password": "no"}).status_code == 401
        r = client.post("/api/ai-access", json={"password": "no"})
        assert r.status_code == 429
        assert "Too many attempts" in r.get_json()["error"]

    def test_the_throttle_outranks_a_correct_password(self, client, gated):
        """Guessing is not rewarded for finally getting it right on attempt six."""
        for _ in range(flask_app._AI_FAIL_LIMIT):
            client.post("/api/ai-access", json={"password": "no"})
        assert client.post("/api/ai-access", json={"password": PASSWORD}).status_code == 429

    def test_old_failures_fall_out_of_the_window(self, client, gated, monkeypatch):
        for _ in range(flask_app._AI_FAIL_LIMIT):
            client.post("/api/ai-access", json={"password": "no"})
        real_monotonic = flask_app.time.monotonic
        monkeypatch.setattr(flask_app.time, "monotonic",
                            lambda: real_monotonic() + flask_app._AI_FAIL_WINDOW_S + 1)
        assert client.post("/api/ai-access", json={"password": PASSWORD}).status_code == 200

    def test_a_success_does_not_count_against_the_caller(self, client, gated):
        for _ in range(20):
            assert client.post("/api/ai-access", json={"password": PASSWORD}).status_code == 200


class TestNoLeakElsewhere:

    def test_health_says_nothing_about_the_gate(self, client, gated):
        r = client.get("/api/health")
        assert PASSWORD not in r.get_data(as_text=True)
        body = r.get_json()
        assert not [k for k in body if "password" in k.lower() or "ai_" in k.lower()]

    def test_the_password_is_never_logged(self, client, gated, caplog):
        with caplog.at_level("DEBUG"):
            client.post("/api/ai-access", json={"password": PASSWORD})
            client.post("/api/ai-access", json={"password": "a wrong guess"})
        assert PASSWORD not in caplog.text
        assert "a wrong guess" not in caplog.text

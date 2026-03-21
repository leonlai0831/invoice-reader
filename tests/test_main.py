"""Tests for main.py — now slim launcher. Tests for moved functions are in test_persistence.py etc."""

import os
import json
import hashlib
import socket
import pytest


class TestAtomicWriteJson:
    def test_writes_and_reads_back(self, tmp_dir):
        from persistence import atomic_write_json
        path = os.path.join(tmp_dir, "data.json")
        atomic_write_json(path, {"rows": [1, 2, 3]})
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        assert data == {"rows": [1, 2, 3]}

    def test_no_tmp_residue(self, tmp_dir):
        from persistence import atomic_write_json
        path = os.path.join(tmp_dir, "data.json")
        atomic_write_json(path, {"a": 1})
        assert sorted(os.listdir(tmp_dir)) == ["data.json"]


class TestBackupJson:
    def test_creates_bak_file(self, tmp_dir):
        from persistence import backup_json, atomic_write_json
        path = os.path.join(tmp_dir, "data.json")
        atomic_write_json(path, {"version": 1})
        backup_json(path)
        bak_path = path + ".bak"
        assert os.path.exists(bak_path)
        with open(bak_path, "r", encoding="utf-8") as f:
            assert json.load(f)["version"] == 1

    def test_skips_empty_file(self, tmp_dir):
        from persistence import backup_json
        path = os.path.join(tmp_dir, "empty.json")
        with open(path, "w") as f:
            f.write("")
        backup_json(path)
        assert not os.path.exists(path + ".bak")

    def test_skips_missing_file(self, tmp_dir):
        from persistence import backup_json
        path = os.path.join(tmp_dir, "nonexistent.json")
        backup_json(path)  # should not raise


class TestFileHash:
    def test_deterministic(self):
        from extraction_cache import _file_hash
        data = b"hello world"
        h1 = _file_hash(data)
        h2 = _file_hash(data)
        assert h1 == h2
        assert h1 == hashlib.sha256(data).hexdigest()

    def test_different_content_different_hash(self):
        from extraction_cache import _file_hash
        assert _file_hash(b"aaa") != _file_hash(b"bbb")


class TestMaxUploadSize:
    def test_value_is_100mb(self):
        from routes.invoice_routes import MAX_UPLOAD_SIZE
        assert MAX_UPLOAD_SIZE == 100 * 1024 * 1024


class TestFindFreePort:
    def test_gets_preferred_port_if_free(self):
        from main import _find_free_port
        port = _find_free_port(preferred=59123)
        assert isinstance(port, int)
        assert port > 0

    def test_falls_back_when_preferred_taken(self):
        from main import _find_free_port
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.bind(("127.0.0.1", 0))
        occupied_port = s.getsockname()[1]
        try:
            port = _find_free_port(preferred=occupied_port)
            assert port != occupied_port
            assert port > 0
        finally:
            s.close()


class TestCompleteClaimFileMove:
    """Tests for file move logic in complete_claim (copy+delete approach)."""

    def _setup_claims_root(self, tmp_dir):
        new_claim = os.path.join(tmp_dir, "New Claim")
        working = os.path.join(tmp_dir, "working")
        os.makedirs(new_claim, exist_ok=True)
        os.makedirs(working, exist_ok=True)
        return new_claim, working

    def _create_file(self, path, content=b"fake invoice data"):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(content)

    def test_local_file_moved_from_new_claim(self, tmp_dir):
        import shutil
        new_claim, _ = self._setup_claims_root(tmp_dir)
        src = os.path.join(new_claim, "receipt.pdf")
        self._create_file(src)
        assert os.path.isfile(src)
        archive = os.path.join(tmp_dir, "2026", "20260311")
        os.makedirs(archive, exist_ok=True)
        dest = os.path.join(archive, "receipt.pdf")
        shutil.copy2(src, dest)
        assert os.path.isfile(dest)
        os.remove(src)
        assert not os.path.isfile(src)

    def test_working_file_moved(self, tmp_dir):
        import shutil
        _, working = self._setup_claims_root(tmp_dir)
        src = os.path.join(working, "1709901234567_receipt.jpg")
        self._create_file(src)
        archive = os.path.join(tmp_dir, "2026", "20260311")
        os.makedirs(archive, exist_ok=True)
        dest = os.path.join(archive, "receipt.jpg")
        shutil.copy2(src, dest)
        assert os.path.isfile(dest)
        os.remove(src)
        assert not os.path.isfile(src)

    def test_manual_row_no_file_skipped(self, tmp_dir):
        row = {"localFilePath": "", "serverFilePath": ""}
        src = None
        lfp = row.get("localFilePath", "")
        if lfp:
            candidate = os.path.join(tmp_dir, lfp)
            if os.path.isfile(candidate):
                src = candidate
        if not src:
            sfp = row.get("serverFilePath", "")
            if sfp:
                candidate = os.path.join(tmp_dir, "working", sfp)
                if os.path.isfile(candidate):
                    src = candidate
        assert src is None

    def test_new_claim_subfolder_file(self, tmp_dir):
        import shutil
        new_claim, _ = self._setup_claims_root(tmp_dir)
        sub = os.path.join(new_claim, "photos")
        os.makedirs(sub, exist_ok=True)
        src = os.path.join(sub, "invoice.jpg")
        self._create_file(src)
        lfp = "New Claim/photos/invoice.jpg"
        full_src = os.path.join(tmp_dir, lfp)
        assert os.path.isfile(full_src)
        archive = os.path.join(tmp_dir, "2026", "20260311")
        os.makedirs(archive, exist_ok=True)
        dest_name = os.path.basename(lfp)
        dest = os.path.join(archive, dest_name)
        shutil.copy2(full_src, dest)
        os.remove(full_src)
        assert os.path.isfile(dest)
        assert not os.path.isfile(full_src)

    def test_empty_subfolder_cleanup(self, tmp_dir):
        new_claim, _ = self._setup_claims_root(tmp_dir)
        sub = os.path.join(new_claim, "photos")
        os.makedirs(sub, exist_ok=True)
        src = os.path.join(sub, "test.jpg")
        self._create_file(src)
        os.remove(src)
        for dirpath, dirnames, filenames in os.walk(new_claim, topdown=False):
            if dirpath != new_claim and not filenames and not dirnames:
                os.rmdir(dirpath)
        assert not os.path.isdir(sub)
        assert os.path.isdir(new_claim)

    def test_duplicate_filename_handled(self, tmp_dir):
        import shutil
        archive = os.path.join(tmp_dir, "archive")
        os.makedirs(archive, exist_ok=True)
        src1 = os.path.join(tmp_dir, "receipt.pdf")
        self._create_file(src1, b"file 1")
        dest1 = os.path.join(archive, "receipt.pdf")
        shutil.copy2(src1, dest1)
        src2 = os.path.join(tmp_dir, "receipt2.pdf")
        self._create_file(src2, b"file 2")
        dest_name = "receipt.pdf"
        dest2 = os.path.join(archive, dest_name)
        if os.path.exists(dest2):
            base, ext = os.path.splitext(dest_name)
            dest2 = os.path.join(archive, f"{base}_1{ext}")
        shutil.copy2(src2, dest2)
        assert os.path.isfile(os.path.join(archive, "receipt.pdf"))
        assert os.path.isfile(os.path.join(archive, "receipt_1.pdf"))


class TestGetRatesHistory:
    """Tests for /api/rates/history endpoint."""

    @pytest.fixture
    def client(self, monkeypatch, tmp_dir):
        monkeypatch.setattr("config.get_claims_root", lambda: tmp_dir)
        from main import app
        app.config["TESTING"] = True
        with app.test_client() as c:
            yield c

    def test_missing_params(self, client):
        rv = client.get("/api/rates/history")
        data = rv.get_json()
        assert data["ok"] is False
        assert "start and end required" in data["error"]

    def test_missing_end_param(self, client):
        rv = client.get("/api/rates/history?start=2026-01-01")
        data = rv.get_json()
        assert data["ok"] is False

    def test_successful_fetch(self, client, monkeypatch):
        import routes.config_routes as cfg_routes

        class MockResp:
            def json(self):
                return {
                    "rates": {
                        "2026-01-02": {"MYR": 0.6521},
                        "2026-01-03": {"MYR": 0.6535},
                        "2026-01-06": {"MYR": 0.6500},
                    }
                }

        def mock_get(url, timeout=10):
            assert "frankfurter" in url
            assert "2026-01-01..2026-01-10" in url
            assert "from=CNY" in url
            assert "to=MYR" in url
            return MockResp()

        monkeypatch.setattr(cfg_routes.req_lib, "get", mock_get)
        rv = client.get("/api/rates/history?start=2026-01-01&end=2026-01-10&base=CNY&target=MYR")
        data = rv.get_json()
        assert data["ok"] is True
        assert len(data["rates"]) == 3
        assert data["rates"]["2026-01-02"] == 0.6521

    def test_network_error_returns_error(self, client, monkeypatch):
        import routes.config_routes as cfg_routes

        def mock_get(url, timeout=10):
            raise ConnectionError("No network")

        monkeypatch.setattr(cfg_routes.req_lib, "get", mock_get)
        rv = client.get("/api/rates/history?start=2026-01-01&end=2026-01-10")
        data = rv.get_json()
        assert data["ok"] is False
        assert data["error"]  # error is now sanitized (no raw exception)

    def test_custom_currencies(self, client, monkeypatch):
        import routes.config_routes as cfg_routes

        class MockResp:
            def json(self):
                return {"rates": {"2026-01-02": {"MYR": 4.45}}}

        def mock_get(url, timeout=10):
            assert "from=USD" in url
            assert "to=MYR" in url
            return MockResp()

        monkeypatch.setattr(cfg_routes.req_lib, "get", mock_get)
        rv = client.get("/api/rates/history?start=2026-01-01&end=2026-01-05&base=USD&target=MYR")
        data = rv.get_json()
        assert data["ok"] is True

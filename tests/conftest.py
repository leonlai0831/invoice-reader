"""Shared fixtures for Invoice Reader tests."""

import os
import sys
import tempfile
import pytest

# Add project root to path so we can import modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@pytest.fixture
def tmp_dir():
    """Provide a temporary directory for test files, cleaned up after."""
    with tempfile.TemporaryDirectory() as d:
        yield d

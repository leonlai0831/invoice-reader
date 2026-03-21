"""Extraction cache — avoids redundant AI API calls by caching results keyed on file hash."""

import hashlib
import json
import os
import threading
from datetime import datetime, timedelta

from persistence import atomic_write_json, logger

CACHE_TTL_DAYS = 30  # entries older than this are evicted on load

_extraction_cache = {}
_extraction_cache_loaded = False
_cache_loaded_for_root = None
_cache_lock = threading.Lock()


def _file_hash(data: bytes) -> str:
    """SHA-256 hash of file content."""
    return hashlib.sha256(data).hexdigest()


def _load_extract_cache(root):
    if not root:
        return {}
    cache_path = os.path.join(root, "extraction_cache.json")
    if os.path.exists(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                raw = json.load(f)
            # Evict expired entries
            cutoff = (datetime.now() - timedelta(days=CACHE_TTL_DAYS)).isoformat()
            evicted = 0
            clean = {}
            for k, v in raw.items():
                if v.get("cachedAt", "") >= cutoff:
                    clean[k] = v
                else:
                    evicted += 1
            if evicted:
                logger.info("Cache: evicted %d expired entries (>%dd)", evicted, CACHE_TTL_DAYS)
            return clean
        except Exception as e:
            logger.warning("Cache load failed: %s", e)
    return {}


def _ensure_cache_loaded(root):
    global _extraction_cache, _extraction_cache_loaded, _cache_loaded_for_root
    if root and (_cache_loaded_for_root != root):
        _extraction_cache = _load_extract_cache(root)
        _extraction_cache_loaded = True
        _cache_loaded_for_root = root


def _save_extract_cache(root, cache):
    if not root:
        return
    cache_path = os.path.join(root, "extraction_cache.json")
    try:
        if len(cache) > 500:
            sorted_keys = sorted(
                cache.keys(), key=lambda k: cache[k].get("cachedAt", "")
            )
            keep = dict((k, cache[k]) for k in sorted_keys[-500:])
            cache.clear()
            cache.update(keep)
        atomic_write_json(cache_path, cache)
    except Exception as e:
        logger.warning("Cache save failed: %s", e)


def cache_get(root, file_bytes):
    """Check if we have a cached extraction result for this file. Returns dict or None."""
    with _cache_lock:
        _ensure_cache_loaded(root)
        fhash = _file_hash(file_bytes)
        entry = _extraction_cache.get(fhash)
        if entry:
            return entry.get("data")
        return None


def cache_put(root, file_bytes, data):
    """Store extraction result in cache."""
    with _cache_lock:
        _ensure_cache_loaded(root)
        fhash = _file_hash(file_bytes)
        _extraction_cache[fhash] = {
            "data": data,
            "cachedAt": datetime.now().isoformat(),
        }
        _save_extract_cache(root, _extraction_cache)


def cache_clear(root):
    """Delete all cached extraction results."""
    global _extraction_cache, _extraction_cache_loaded, _cache_loaded_for_root
    with _cache_lock:
        _extraction_cache = {}
        _extraction_cache_loaded = False
        _cache_loaded_for_root = None
        if root:
            cache_path = os.path.join(root, "extraction_cache.json")
            try:
                if os.path.exists(cache_path):
                    os.remove(cache_path)
                    logger.info("Extraction cache cleared")
            except Exception as e:
                logger.warning("Cache clear failed: %s", e)


def cache_stats(root):
    """Return cache entry count."""
    with _cache_lock:
        _ensure_cache_loaded(root)
        return len(_extraction_cache)

"""Read-only, unauthenticated Synology API discovery using the Python standard library."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import ssl
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, HTTPSHandler, ProxyHandler, Request, build_opener

ROOT = Path(__file__).resolve().parents[1]
MAX_RESPONSE = 4 * 1024 * 1024


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class DiscoveryRefused(Exception):
    def __init__(self, code):
        self.code = code if type(code) is int else None


def server_origin(server: str, allow_http: bool) -> str:
    parsed = urlsplit(server.strip())
    if (parsed.scheme not in ("https", "http") or not parsed.hostname
            or parsed.username is not None or parsed.password is not None
            or parsed.query or parsed.fragment or parsed.path not in ("", "/")):
        raise ValueError("Specify a NAS root URL without credentials, query, or path.")
    _ = parsed.port  # Validate an explicitly supplied port.
    if parsed.scheme == "http" and not allow_http:
        raise ValueError("HTTP requires an explicit --allow-http option.")
    return f"{parsed.scheme}://{parsed.netloc}"


def discover(origin: str, context: ssl.SSLContext, include_all: bool) -> dict:
    opener = build_opener(ProxyHandler({}), NoRedirect(), HTTPSHandler(context=context))
    body = urlencode({"api": "SYNO.API.Info", "version": "1", "method": "query", "query": "all"}).encode("ascii")
    request = Request(f"{origin}/webapi/query.cgi", data=body,
                      headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"})
    with opener.open(request, timeout=20) as response:
        raw = response.read(MAX_RESPONSE + 1)
    if len(raw) > MAX_RESPONSE:
        raise ValueError("Discovery response exceeds the 4 MiB limit.")
    envelope = json.loads(raw)
    if not isinstance(envelope, dict):
        raise ValueError("Discovery returned an unexpected JSON type.")
    if envelope.get("success") is not True:
        error = envelope.get("error")
        code = error.get("code") if isinstance(error, dict) else None
        raise DiscoveryRefused(code)
    data = envelope.get("data")
    if not isinstance(data, dict):
        raise ValueError("Discovery response has no API dictionary.")
    apis = {}
    supporting = {"SYNO.API.Info", "SYNO.API.Auth", "SYNO.Entry.Request", "SYNO.Entry.Request.Polling"}
    for name, info in sorted(data.items()):
        if not include_all and not (name.startswith("SYNO.NoteStation.") or name in supporting):
            continue
        if not isinstance(info, dict):
            continue
        route, minimum, maximum = info.get("path"), info.get("minVersion"), info.get("maxVersion")
        if not isinstance(route, str) or type(minimum) is not int or type(maximum) is not int:
            continue
        if minimum < 1 or maximum < minimum:
            continue
        # Retain only metadata, never arbitrary fields returned by the server.
        apis[name] = {"path": route, "minVersion": minimum, "maxVersion": maximum}
    return apis


def main() -> int:
    parser = argparse.ArgumentParser(description="Save API paths/versions using anonymous SYNO.API.Info.query; never logs in or reads notes.")
    parser.add_argument("--server", required=True, help="NAS root, for example https://nas.example:5001")
    parser.add_argument("--output", type=Path, default=ROOT / "docs/api/server-capabilities.local.json")
    trust = parser.add_mutually_exclusive_group()
    trust.add_argument("--ca-file", type=Path, help="Additional trusted public CA/server PEM certificate")
    trust.add_argument("--insecure", action="store_true", help="Explicitly disable HTTPS certificate verification")
    parser.add_argument("--allow-http", action="store_true", help="Explicitly allow a plaintext http:// NAS address")
    parser.add_argument("--all", action="store_true", help="Save all APIs instead of Note Station and supporting APIs")
    args = parser.parse_args()
    try:
        origin = server_origin(args.server, args.allow_http)
        if origin.startswith("http:") and (args.ca_file or args.insecure):
            raise ValueError("TLS options apply only to an https:// server.")
        context = ssl.create_default_context()
        if args.ca_file:
            pem = args.ca_file.read_bytes()
            if len(pem) > 64 * 1024 or b"PRIVATE KEY" in pem:
                raise ValueError("Use a public PEM certificate up to 64 KiB, without a private key.")
            context.load_verify_locations(cafile=str(args.ca_file))
        if args.insecure:
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
        apis = discover(origin, context, args.all)
        snapshot = {"server": origin, "scope": "all" if args.all else "notestation", "apis": apis}
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Saved {len(apis)} API definitions to {args.output}")
        if not any(name.startswith("SYNO.NoteStation.") for name in apis):
            print("No Note Station definitions were returned; check package installation and discovery access.")
        return 0
    except DiscoveryRefused as error:
        print(f"Discovery refused by NAS: API code {error.code if error.code is not None else 'unknown'}.", file=sys.stderr)
    except HTTPError as error:
        print(f"Discovery failed: HTTP {error.code}; redirects are not followed.", file=sys.stderr)
    except URLError:
        print("Discovery failed: network or TLS error. Check the NAS address and certificate.", file=sys.stderr)
    except (ValueError, OSError):
        # Exception text from a server response/URL is deliberately not echoed.
        print("Discovery failed: invalid options, file, or API response. Run --help to check usage.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

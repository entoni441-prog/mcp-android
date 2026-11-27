"""STAGING-only unsigned native Runner packager. Never signs or installs.
Produces a new archive; strips known bundled XCTest runtimes; aligns test bundle ID.
The final local signer MUST recheck outer/nested ID after adding the actual profile.
"""
import argparse
import copy
import hashlib
import json
import plistlib
import zipfile
from pathlib import Path

ROOT = "Payload/RunnerUITests-Runner.app/"
NESTED = ROOT + "PlugIns/RunnerUITests.xctest/"
RUNTIMES = {"Testing.framework", "XCTAutomationSupport.framework",
            "XCTest.framework", "XCTestCore.framework", "XCTestSupport.framework",
            "XCUIAutomation.framework", "XCUnit.framework", "libXCTestSwiftSupport.dylib"}

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def drop(name):
    if "_CodeSignature" in name.split("/") or name.endswith("/embedded.mobileprovision"):
        return True
    if name.startswith(ROOT + "Frameworks/"):
        rel = name[len(ROOT + "Frameworks/"):].split("/")[0]
        return not rel or rel in RUNTIMES
    return False

def verify(path, *, expected_id=None, signed=False):
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        assert len(names) == len(set(names)) and z.testzip() is None, "ZIP_INTEGRITY"
        outer = plistlib.loads(z.read(ROOT + "Info.plist"))
        inner = plistlib.loads(z.read(NESTED + "Info.plist"))
        assert outer["CFBundleIdentifier"] == inner["CFBundleIdentifier"], "BUNDLE_ID_MISMATCH"
        if expected_id:
            assert outer["CFBundleIdentifier"] == expected_id, "BUNDLE_ID_PIN"
        assert ROOT + outer["CFBundleExecutable"] in names
        assert NESTED + inner["CFBundleExecutable"] in names
        assert not any(n.startswith(ROOT + "Frameworks/") and
                       n[len(ROOT+"Frameworks/"):].split("/")[0] in RUNTIMES for n in names)
        if signed:
            assert ROOT + "embedded.mobileprovision" in names
            assert ROOT + "_CodeSignature/CodeResources" in names
            assert NESTED + "_CodeSignature/CodeResources" in names
        else:
            assert not any(n.endswith("/embedded.mobileprovision") for n in names)
        return {"sha256": digest(path), "bundle_id": outer["CFBundleIdentifier"],
                "sdk": outer.get("DTSDKName"), "signed_structure": signed}

def package(source, target, final_bundle_id=None):
    assert source.resolve() != target.resolve() and not target.exists(), "DO_NOT_OVERWRITE"
    original = digest(source)
    with zipfile.ZipFile(source) as src:
        names = src.namelist()
        assert len(names) == len(set(names)) and src.testzip() is None
        outer = plistlib.loads(src.read(ROOT + "Info.plist"))
        inner = plistlib.loads(src.read(NESTED + "Info.plist"))
        ident = final_bundle_id or outer["CFBundleIdentifier"]
        assert ident.startswith("org.entoni.iosstaging.runnerhost.uitests.xctrunner"), "SCOPE"
        outer["CFBundleIdentifier"] = ident
        inner["CFBundleIdentifier"] = ident
        replacements = {ROOT+"Info.plist": plistlib.dumps(outer, fmt=plistlib.FMT_BINARY),
                        NESTED+"Info.plist": plistlib.dumps(inner, fmt=plistlib.FMT_BINARY)}
        with zipfile.ZipFile(target, "x", compression=zipfile.ZIP_DEFLATED) as dst:
            for info in src.infolist():
                n = info.filename
                if not drop(n):
                    dst.writestr(copy.copy(info), replacements[n] if n in replacements else src.read(n))
        with zipfile.ZipFile(target) as dst:
            for n in dst.namelist():
                if n not in replacements:
                    assert src.read(n) == dst.read(n), "UNEXPECTED_MEMBER_CHANGE"
    assert digest(source) == original, "ORIGINAL_CHANGED"
    out = verify(target, expected_id=ident)
    out.update({"source_sha256": original, "requires_local_resign": True,
                "installed": False, "native_launch_proven": False})
    return out

if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("source", type=Path)
    p.add_argument("target", type=Path, nargs="?")
    p.add_argument("--bundle-id")
    p.add_argument("--verify-signed", action="store_true")
    a = p.parse_args()
    if a.verify_signed:
        assert a.target is None
        print(json.dumps(verify(a.source, expected_id=a.bundle_id, signed=True)))
    else:
        assert a.target is not None
        print(json.dumps(package(a.source, a.target, a.bundle_id)))

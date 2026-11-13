"""Build a deterministic source-only SAR package; never installs or deploys.

Root workflow (paths are examples, generate after all writers finish):
  python3 scripts/build-sar-science-package.py inventory --source-root /opt/earthsignal/service > old.json
  python3 scripts/build-sar-science-package.py build --source-root service \\
    --old-inventory old.json --old-method ACTUAL_OLD_METHOD \\
    --old-sar-method ABSENT --package science.tar.gz --manifest source.json

Run inventory on the host only as authorized root, without reading .venv/env/netrc.
The old inventory MUST be the actual current production snapshot, never a repo
baseline or guessed ABSENT map. --old-sar-method is the actual old method or ABSENT.
NEW method identities are parsed from candidate source, not imported/executed.

Activation additionally requires a separately generated, SHA-256-pinned JSON:
 {"schema":"earthsignal.sar-approval/1","approved":true,
  "manifest_sha256":"<actual source.json hash>","package_sha256":"<actual tar hash>",
  "expires_at":<UTC Unix timestamp no more than 24h ahead>,
  "venv":"<actual stable external venv absolute path>",
  "runtime":{"numpy":"<actual>","Pillow":"<actual>","h5py":"<actual>",
             "GDAL":"<actual>","fastapi":"<actual>","uvicorn":"<actual>"},
  "checks":{"environment":true,"resources":true,"rollback_compatible":true},
  "retained":{"<prepared job ID>":{"manifestHash":"<SHA256 raw DB result string>",
                                   "files":{"<artifact name>":"<actual SHA256>"}}}}
An explicit {} retained inventory is valid only when actually observed empty.
Root must review environment/RCM flag approval, supervised unit definitions,
resource limits, unchanged DB schema/old-worker compatibility, artifact expiry and
retention, and web/API integration before setting checks true. Runtime versions
must be measured using the exact service venv (GDAL uses gdal.__version__).
The receipt is a local operator attestation, not a signature/entitlement proof.

Then root may separately execute the recipe with --manifest source.json
 --manifest-sha256 HASH --package science.tar.gz --receipt approval.json
 --receipt-sha256 HASH. --action rollback requires a fresh approval receipt and
an accepted activation.json; it never restores a DB and requires an empty queue.
No approval template produced here has invented live values or true checks.
"""
import argparse
import ast
import gzip
import importlib.util
import io
import json
from pathlib import Path
import tarfile

spec = importlib.util.spec_from_file_location('sar_activation_recipe', Path(__file__).with_name('activate-science-sar-r24-20261114.py'))
recipe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recipe)


def inventory(root):
    """Only runtime source/data/requirements, no symlink following or credentials."""
    return recipe.runtime_inventory(root)


def method(root, relative, name):
    tree = ast.parse((root / relative).read_text(), filename=relative)
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in node.targets):
            value = ast.literal_eval(node.value)
            if isinstance(value, str):
                return value
    raise RuntimeError('Explicit method constant unavailable: ' + relative)


def check_imports(root, sources):
    """All resolvable service imports, including lazy imports, must be packaged."""
    modules = {('service.' + n[:-3].replace('/', '.')).removesuffix('.__init__'): n
               for n in sources if n.endswith('.py')}
    modules['service'] = '__init__.py'
    for relative in (n for n in sources if n.endswith('.py')):
        tree = ast.parse((root / relative).read_bytes(), filename=relative)
        package = ('service.' + relative.replace('/', '.')).rsplit('.', 2)[0]
        if relative.endswith('__init__.py'):
            package = 'service.' + relative.removesuffix('/__init__.py').replace('/', '.') if '/' in relative else 'service'
        for node in ast.walk(tree):
            candidates = []
            if isinstance(node, ast.Import):
                candidates = [a.name for a in node.names if a.name == 'service' or a.name.startswith('service.')]
            elif isinstance(node, ast.ImportFrom):
                if node.level:
                    base = package.split('.')
                    prefix = '.'.join(base[:len(base) - node.level + 1])
                    module = prefix + ('.' + node.module if node.module else '')
                else:
                    module = node.module or ''
                if module == 'service' or module.startswith('service.'):
                    candidates.append(module)
                    candidates.extend(module + '.' + a.name for a in node.names if module + '.' + a.name in modules)
            for candidate in candidates:
                if candidate not in modules:
                    raise RuntimeError('Unpackaged service import: ' + relative + ' -> ' + candidate)


def build(root, old, package, manifest_path, old_method, old_sar_method):
    root, package, manifest_path = Path(root), Path(package), Path(manifest_path)
    if package.exists() or package.is_symlink() or manifest_path.exists() or manifest_path.is_symlink() or package.resolve() == manifest_path.resolve():
        raise RuntimeError('Output exists; do not overwrite a prior release')
    if type(old) is not dict or not old:
        raise RuntimeError('Actual OLD source inventory required')
    for name, digest in old.items():
        recipe.safe_name(name)
        if not recipe.valid_hash(digest):
            raise RuntimeError('OLD inventory must contain observed existing hashes, not guessed sentinels')
    new = inventory(root)
    check_imports(root, new)
    names = sorted(set(old) | set(new))
    manifest = dict(schema='earthsignal.sar-source/1', release=recipe.VERSION,
                    package_sha256='0' * 64,
                    old={n: old.get(n, recipe.ABSENT) for n in names},
                    new={n: new.get(n, recipe.ABSENT) for n in names},
                    old_method=old_method, new_method=method(root, 'observatory/net.py', 'METHOD_VERSION'),
                    old_sar_method=None if old_sar_method == recipe.ABSENT else old_sar_method,
                    new_sar_method=method(root, 'sar/jobs.py', 'METHOD'))
    recipe.validate_manifest(manifest)
    # Serialize in memory under the same hard package budget; no tar metadata from
    # local uid/mtime, no AppleDouble/xattrs, directories, links, venv or secrets.
    buffer = io.BytesIO()
    with gzip.GzipFile(fileobj=buffer, mode='wb', filename='', mtime=0) as compressed:
        with tarfile.open(fileobj=compressed, mode='w', format=tarfile.USTAR_FORMAT) as archive:
            total = 0
            for name, digest in new.items():
                data = recipe.regular(root / name).read_bytes()
                total += len(data)
                if total > recipe.MAX_EXPANDED or recipe.sha(data) != digest:
                    raise RuntimeError('Candidate source changed or expanded limit exceeded')
                info = tarfile.TarInfo('service/' + name)
                info.size = len(data)
                info.mode = 0o644
                info.uid = info.gid = info.mtime = 0
                archive.addfile(info, io.BytesIO(data))
    raw = buffer.getvalue()
    if len(new) > recipe.MAX_MEMBERS or len(raw) > recipe.MAX_PACKAGE or inventory(root) != new:
        raise RuntimeError('Package limit or candidate changed during build')
    manifest['package_sha256'] = recipe.sha(raw)
    recipe.validate_manifest(manifest)
    with package.open('xb') as output:
        output.write(raw)
    with manifest_path.open('x') as output:
        json.dump(manifest, output, indent=2, sort_keys=True)
        output.write('\n')
    return {'package_sha256': manifest['package_sha256'],
            'manifest_sha256': recipe.sha(manifest_path.read_bytes()),
            'source_files': len(new), 'inventory_files': len(names),
            'new_method': manifest['new_method'], 'new_sar_method': manifest['new_sar_method']}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    scan = sub.add_parser('inventory', help='Print measured source inventory only; never credentials/venv')
    scan.add_argument('--source-root', type=Path, required=True)
    package = sub.add_parser('build', help='Build locally using actual root-provided OLD inventory')
    package.add_argument('--source-root', type=Path, default=Path('service'))
    package.add_argument('--old-inventory', type=Path, required=True)
    package.add_argument('--old-method', required=True)
    package.add_argument('--old-sar-method', required=True, help='Actual old SAR METHOD, or ABSENT when not installed')
    package.add_argument('--package', type=Path, required=True)
    package.add_argument('--manifest', type=Path, required=True)
    args = parser.parse_args()
    if args.command == 'inventory':
        print(json.dumps(inventory(args.source_root), indent=2, sort_keys=True))
    else:
        old = json.loads(recipe.regular(args.old_inventory).read_text())
        print(json.dumps(build(args.source_root, old, args.package, args.manifest,
                               args.old_method, args.old_sar_method), sort_keys=True))


if __name__ == '__main__':
    main()

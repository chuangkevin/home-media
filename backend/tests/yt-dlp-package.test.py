import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import tempfile
from unittest import mock
import unittest
import zipfile
from contextlib import redirect_stdout


SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/prepare-yt-dlp.py'
spec = importlib.util.spec_from_file_location('prepare_ytdlp', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
VERSION = '2026.08.19'
ENTRY = '''import sys,json,os,signal,time
import yt_dlp
if '--version' in sys.argv:
 print(yt_dlp.VERSION)
elif '--wait' in sys.argv:
 signal.signal(signal.SIGTERM,lambda *_:None)
 print(os.getpid(),flush=True)
 while True: time.sleep(.05)
elif '--loader' in sys.argv:
 print(type(yt_dlp.__loader__).__name__)
elif '--binary' in sys.argv:
 sys.stdout.buffer.write(sys.stdin.buffer.read())
else: print(json.dumps(sys.argv[1:],ensure_ascii=False))
'''


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='yt-dlp-package-')
        self.root = Path(self.temp.name)
        self.archive = self.root / 'folder with spaces' / 'yt-dlp'
        self.archive.parent.mkdir()
        self.entries = {'__main__.py': ENTRY.encode(),
                        'yt_dlp/__init__.py': f'VERSION={VERSION!r}\n'.encode(),
                        'yt_dlp/resource.txt': b'unchanged resource\0bytes',
                        'LICENSE': b'original upstream license'}
        self.write_archive()

    def tearDown(self):
        self.temp.cleanup()

    def write_archive(self, extra=None):
        with zipfile.ZipFile(self.archive, 'w') as out:
            for name, data in self.entries.items():
                out.writestr(name, data)
            if extra:
                out.writestr(*extra)
        self.original = self.archive.read_bytes()
        self.digest = hashlib.sha256(self.original).hexdigest()

    def prepare(self, digest=None, version=VERSION):
        with redirect_stdout(io.StringIO()):
            return module.prepare(self.archive, digest or self.digest, version)

    def assert_unmodified(self):
        self.assertEqual(self.archive.read_bytes(), self.original)
        self.assertFalse(Path(str(self.archive) + '.unpacked').exists())
        self.assertEqual(list(self.archive.parent.glob('.yt-dlp-*')), [])

    def test_source_resources_license_and_provenance_are_preserved(self):
        provenance = self.prepare()
        self.assertEqual(provenance['archive_sha256'], self.digest)
        self.assertEqual(provenance['version'], VERSION)
        self.assertEqual(provenance['bytecode_validation'], 'checked-hash')
        with zipfile.ZipFile(self.archive) as prepared:
            for name, data in self.entries.items():
                self.assertEqual(prepared.read(name), data)
                self.assertEqual(provenance['source_sha256'][name], hashlib.sha256(data).hexdigest())
            self.assertEqual(json.loads(prepared.read('_radio_cli_provenance.json')), provenance)
            for name in ['__main__.pyc', 'yt_dlp/__init__.pyc']:
                self.assertEqual(int.from_bytes(prepared.read(name)[4:8], 'little'), 3)
        self.assertTrue(os.access(self.archive, os.X_OK))

    def test_cli_version_and_quoted_arguments_are_equivalent(self):
        args = ['-o', '-', 'space and 中文', '$(literal)', '--cookies', 'test fixture only']
        old = subprocess.check_output([sys.executable, str(self.archive), *args])
        self.prepare()
        new = subprocess.check_output([str(self.archive), *args])
        self.assertEqual(old, new)
        self.assertEqual(subprocess.check_output([str(self.archive), '--version']).strip(), VERSION.encode())

    def test_stdin_and_binary_stdout_are_preserved(self):
        self.prepare()
        data = bytes(range(256)) * 1024
        out = subprocess.run([str(self.archive), '--binary'], input=data, capture_output=True, check=True)
        self.assertEqual(out.stdout, data)
        self.assertEqual(out.stderr, b'')

    def test_zipapp_keeps_python_pid_and_kill_is_reaped(self):
        self.prepare()
        child = subprocess.Popen([str(self.archive), '--wait'], stdout=subprocess.PIPE)
        try:
            self.assertEqual(int(child.stdout.readline()), child.pid)
            child.send_signal(signal.SIGTERM)
            with self.assertRaises(subprocess.TimeoutExpired):
                child.wait(timeout=.1)
            child.kill()
            self.assertEqual(child.wait(timeout=2), -signal.SIGKILL)
            with self.assertRaises(ProcessLookupError):
                os.kill(child.pid, 0)
        finally:
            if child.poll() is None:
                child.kill()
                child.wait(timeout=2)
            child.stdout.close()

    def test_bytecode_is_prepared_before_first_runtime_invocation(self):
        self.prepare()
        before = self.archive.read_bytes()
        subprocess.check_call([str(self.archive), '--version'], stdout=subprocess.DEVNULL)
        self.assertEqual(before, self.archive.read_bytes())
        self.assertFalse(Path(str(self.archive) + '.unpacked').exists())
        self.assertEqual(subprocess.check_output([str(self.archive), '--loader']).strip(), b'zipimporter')

    def test_symlink_invocation_keeps_cli_arguments(self):
        linked = self.root / 'linked-yt-dlp'
        linked.symlink_to(self.archive)
        self.prepare()
        self.assertEqual(subprocess.check_output([str(linked), '--version']).strip(), VERSION.encode())

    def test_invalid_compilation_preserves_original_archive(self):
        self.write_archive(('yt_dlp/broken.py', b'not valid Python!'))
        with self.assertRaises(Exception):
            self.prepare()
        self.assert_unmodified()

    def test_version_timeout_preserves_original_archive(self):
        with mock.patch.object(module.subprocess, 'run', side_effect=subprocess.TimeoutExpired('version', 15)):
            with self.assertRaises(subprocess.TimeoutExpired):
                self.prepare()
        self.assert_unmodified()

    def test_failed_atomic_replacement_preserves_original_archive(self):
        with mock.patch.object(module.os, 'replace', side_effect=OSError('fixture rename failure')):
            with self.assertRaisesRegex(OSError, 'fixture rename failure'):
                self.prepare()
        self.assert_unmodified()

    def test_preparation_is_reproducible_at_different_paths(self):
        second = self.root / 'another-yt-dlp'
        second.write_bytes(self.original)
        self.prepare()
        with redirect_stdout(io.StringIO()):
            module.prepare(second, self.digest, VERSION)
        self.assertEqual(self.archive.read_bytes(), second.read_bytes())

    def test_checked_bytecode_does_not_hide_changed_source(self):
        self.prepare()
        changed = self.root / 'changed-yt-dlp'
        with zipfile.ZipFile(self.archive) as source, changed.open('wb') as file:
            file.write(b'#!/usr/bin/env python3\n')
            with zipfile.ZipFile(file, 'w', compression=zipfile.ZIP_DEFLATED) as output:
                for item in source.infolist():
                    data = source.read(item)
                    if item.filename == 'yt_dlp/__init__.py':
                        data = b"VERSION='2026.08.20'\n"
                    output.writestr(item, data)
        changed.chmod(0o755)
        self.assertEqual(subprocess.check_output([str(changed), '--version']).strip(), b'2026.08.20')

    def test_preparation_uses_the_verified_archive_snapshot(self):
        factory = module.zipfile.ZipFile
        opened = False

        def open_archive(*args, **kwargs):
            nonlocal opened
            if not opened:
                opened = True
                self.archive.write_bytes(b'changed after checksum verification')
            return factory(*args, **kwargs)

        with mock.patch.object(module.zipfile, 'ZipFile', side_effect=open_archive):
            provenance = self.prepare()
        self.assertEqual(provenance['archive_sha256'], self.digest)
        with factory(self.archive) as prepared:
            for name, data in self.entries.items():
                self.assertEqual(prepared.read(name), data)

    def test_mismatched_digest_fails_before_modification(self):
        with self.assertRaisesRegex(ValueError, 'SHA-256 mismatch'):
            self.prepare('0' * 64)
        self.assert_unmodified()

    def test_mismatched_version_cleans_only_staging(self):
        with self.assertRaisesRegex(ValueError, 'version mismatch'):
            self.prepare(version='2026.08.18')
        self.assert_unmodified()

    def test_path_escape_and_absolute_entries_are_rejected(self):
        for name in ['../escape.py', '/absolute.py', 'nested/../../escape.py', 'nested\\escape.py']:
            with self.subTest(name=name):
                self.write_archive((name, b'not allowed'))
                with self.assertRaisesRegex(ValueError, 'Unsafe'):
                    self.prepare()
                self.assert_unmodified()
        self.assertFalse((self.root / 'escape.py').exists())

    def test_symlink_entry_is_rejected(self):
        info = zipfile.ZipInfo('yt_dlp/symlink')
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        self.write_archive((info, b'/unowned'))
        with self.assertRaisesRegex(ValueError, 'Unsafe'):
            self.prepare()
        self.assert_unmodified()

    def test_docker_locks_same_tag_digest_and_prepares_only_runtime(self):
        dockerfile = (SCRIPT.parents[1] / 'Dockerfile').read_text()
        self.assertEqual(dockerfile.count('releases/tags/${YT_DLP_VERSION}'), 2)
        self.assertIn('1fa6733c37ea6fb51c99ad8fe785e7b7e5f3246c9b980230329d4fb72ed8d4d6', dockerfile)
        self.assertEqual(dockerfile.count('RUN python3 scripts/prepare-yt-dlp.py'), 1)


if __name__ == '__main__':
    unittest.main()

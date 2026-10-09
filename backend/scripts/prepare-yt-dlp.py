#!/usr/bin/env python3
"""Add checked bytecode to the verified official zipapp during image build.

All original source/resources and the original zip CLI location stay intact.
The executable still runs in one Python producer PID; no launcher is added.
This script never fetches or modifies upstream extractor source.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import py_compile
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import zipfile


def prepare(archive, expected_sha256, expected_version):
    archive = Path(archive)
    if not re.fullmatch(r'[0-9a-f]{64}', expected_sha256):
        raise ValueError('Expected official SHA-256 must contain 64 lowercase hex digits')
    if not re.fullmatch(r'\d{4}\.\d{2}\.\d{2}', expected_version):
        raise ValueError('Expected official version must use YYYY.MM.DD')
    if archive.stat().st_size > 32 * 1024 * 1024:
        raise ValueError('Official archive exceeds preparation budget')
    original = archive.read_bytes()
    digest = hashlib.sha256(original).hexdigest()
    if digest != expected_sha256:
        raise ValueError('Official archive SHA-256 mismatch')
    staging = Path(tempfile.mkdtemp(prefix='.yt-dlp-prepare-', dir=archive.parent))
    prepared = staging / 'yt-dlp'
    try:
        sources = {}
        with zipfile.ZipFile(io.BytesIO(original)) as source:
            entries = source.infolist()
            if not entries or len(entries) > 10000 or sum(item.file_size for item in entries) > 128 * 1024 * 1024:
                raise ValueError('Official source exceeds preparation budget')
            names = set()
            for item in entries:
                path = PurePosixPath(item.filename)
                mode = stat.S_IFMT(item.external_attr >> 16)
                if (not item.filename or path.is_absolute() or '..' in path.parts
                        or '\\' in item.filename or item.filename in names
                        or mode not in (0, stat.S_IFREG, stat.S_IFDIR)):
                    raise ValueError('Unsafe or duplicate archive entry')
                names.add(item.filename)
            if '__main__.py' not in names or 'yt_dlp/__init__.py' not in names:
                raise ValueError('Expected official Python zipapp structure is missing')
            if '_radio_cli_provenance.json' in names:
                raise ValueError('Official archive conflicts with build provenance')
            prefix = original[:min(item.header_offset for item in entries)]
            if len(prefix) > 4096:
                raise ValueError('Official executable prefix exceeds preparation budget')
            with prepared.open('wb') as file:
                file.write(prefix or b'#!/usr/bin/env python3\n')
                with zipfile.ZipFile(file, 'w', compression=zipfile.ZIP_DEFLATED) as output:
                    output.comment = source.comment
                    for item in entries:
                        data = source.read(item)
                        output.writestr(item, data)
                        if item.is_dir():
                            continue
                        sources[item.filename] = hashlib.sha256(data).hexdigest()
                        if item.filename.endswith('.py'):
                            bytecode_name = item.filename[:-3] + '.pyc'
                            if bytecode_name in names:
                                raise ValueError('Official source already contains conflicting bytecode')
                            module = staging / 'module.py'; module.write_bytes(data)
                            bytecode = staging / 'module.pyc'
                            py_compile.compile(
                                str(module), str(bytecode), dfile=item.filename, doraise=True,
                                invalidation_mode=py_compile.PycInvalidationMode.CHECKED_HASH,
                            )
                            bytecode_info = zipfile.ZipInfo(bytecode_name, date_time=item.date_time)
                            bytecode_info.compress_type = zipfile.ZIP_DEFLATED
                            output.writestr(bytecode_info, bytecode.read_bytes())
                    provenance = {'version': expected_version, 'archive_sha256': digest,
                                  'python_version': sys.version.split()[0],
                                  'bytecode_validation': 'checked-hash', 'source_sha256': sources}
                    metadata = zipfile.ZipInfo('_radio_cli_provenance.json', date_time=entries[0].date_time)
                    metadata.compress_type = zipfile.ZIP_DEFLATED
                    output.writestr(metadata, json.dumps(provenance, sort_keys=True) + '\n')
        prepared.chmod(0o755)
        version = subprocess.run(
            [sys.executable, str(prepared), '--ignore-config', '--version'],
            check=True, capture_output=True, text=True, timeout=15,
        ).stdout.strip()
        if version != expected_version:
            raise ValueError('Official CLI version mismatch')
        prepared_digest = hashlib.sha256(prepared.read_bytes()).hexdigest()
        os.replace(prepared, archive)
        print(json.dumps({'yt_dlp_version': version, 'archive_sha256': digest,
                          'prepared_sha256': prepared_digest, 'prepared_source_files': len(sources),
                          'launcher': 'original-zipapp', 'bytecode_validation': 'checked-hash'}))
        return provenance
    finally:
        shutil.rmtree(staging)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', required=True)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--version', required=True)
    args = parser.parse_args()
    prepare(args.archive, args.sha256, args.version)

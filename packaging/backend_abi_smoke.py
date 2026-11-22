"""Exercise the NumPy/Arrow ABI pair from the target lock, without model downloads."""
import argparse
from pathlib import Path
import platform
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]

def main(install):
    if sys.version_info[:2] != (3, 11):
        raise ValueError('Backend ABI check requires Python 3.11')
    system = {'Windows': 'windows', 'Linux': 'linux', 'Darwin': 'macos'}[platform.system()]
    arch = 'arm64' if platform.machine().lower() in {'arm64', 'aarch64'} else 'x64'
    lock = ROOT / 'packaging/locks' / f'dashboard-{system}-{arch}-py311.txt'
    selected = []
    active = False
    for line in lock.read_text(encoding='utf-8').splitlines(keepends=True):
        if line and not line[0].isspace() and not line.startswith('#'):
            active = line.startswith(('numpy==', 'pyarrow=='))
        if active:
            selected.append(line)
    if install:
        with tempfile.TemporaryDirectory(prefix='starli-backend-abi-') as temp:
            requirements = Path(temp) / 'requirements.txt'
            requirements.write_text(''.join(selected), encoding='utf-8')
            subprocess.run([sys.executable, '-m', 'pip', 'install', '--disable-pip-version-check',
                            '--require-hashes', '--no-deps', '--only-binary=:all:',
                            '-r', str(requirements)], check=True)
    import numpy as np
    import pyarrow as pa
    import pyarrow.parquet as parquet
    expected = dict(line.split('==', 1) for line in ''.join(selected).splitlines()
                    if line.startswith(('numpy==', 'pyarrow==')))
    assert np.__version__ == expected['numpy'].rstrip(' \\'), 'Wrong NumPy runtime'
    assert pa.__version__ == expected['pyarrow'].rstrip(' \\'), 'Wrong Arrow runtime'
    values = np.array([1, 2, 3], dtype=np.int64)
    table = pa.table({'number': pa.array(values)})
    buffer = pa.BufferOutputStream()
    parquet.write_table(table, buffer)
    restored = parquet.read_table(pa.BufferReader(buffer.getvalue()))
    assert restored.to_pydict() == {'number': [1, 2, 3]}
    print(f'{system}-{arch}: NumPy {np.__version__}, PyArrow {pa.__version__}; array/Parquet roundtrip passed')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--install', action='store_true', help='Install the two hash-locked wheels in the current Python environment')
    main(parser.parse_args().install)

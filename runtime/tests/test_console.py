import contextlib
import importlib.util
from pathlib import Path
import struct
import sys
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).parents[1]))
import console

class ConsoleTests(unittest.TestCase):
    def test_uppercase_keysym_retains_case(self):
        # Actual QEMU guest regressed to lowercase if A was sent as Shift+a.
        sock = Mock()
        @contextlib.contextmanager
        def connection():
            yield sock, (800, 600)
        with patch.object(console, 'vnc', connection), patch.object(console.time, 'sleep'):
            console.type_text('Aa:')
        keys = [struct.unpack('!BBHI', call.args[0])[3] for call in sock.sendall.call_args_list]
        self.assertIn(ord('A'), keys)
        self.assertIn(ord('a'), keys)
        self.assertIn(ord(';'), keys)
        self.assertIn(0xffe1, keys)

    def test_pointer_rejects_outside_frame_without_input(self):
        sock = Mock()
        @contextlib.contextmanager
        def connection():
            yield sock, (800, 600)
        with patch.object(console, 'vnc', connection), self.assertRaises(RuntimeError):
            console.pointer(800, 0, 'left')
        sock.sendall.assert_not_called()

if __name__ == '__main__':
    unittest.main()

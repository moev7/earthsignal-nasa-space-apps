"""Export transaction failure tests independent of native raster availability."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from service.observatory.views import export_comparison


class ExportTransactionTests(unittest.TestCase):
    def test_decoder_failure_discards_partial_files(self):
        with tempfile.TemporaryDirectory() as root:
            path=Path(root);(path/'request.json').write_text('preserved')
            def fail(*args):
                (Path(args[-1])/'ndvi-before.tif').write_bytes(b'partial')
                raise RuntimeError('synthetic decoder failure')
            with patch('service.observatory.views._export_comparison',side_effect=fail):
                with self.assertRaises(RuntimeError):export_comparison({}, {}, {}, {}, path)
            self.assertEqual({p.name for p in path.iterdir()},{'request.json'})
            self.assertEqual((path/'request.json').read_text(),'preserved')

    def fixture(self,*args):
        path=Path(args[-1])
        for name in ('ndvi-before.tif','ndvi-before.png'): (path/name).write_bytes(b'fixture')
        return [dict(files=dict(before=dict(raster='ndvi-before.tif',preview='ndvi-before.png')))]

    def test_success_moves_only_referenced_files(self):
        with tempfile.TemporaryDirectory() as root,patch('service.observatory.views._export_comparison',side_effect=self.fixture):
            path=Path(root);views=export_comparison({}, {}, {}, {}, path)
            self.assertEqual(len(views),1)
            self.assertEqual({p.name for p in path.iterdir()},{'ndvi-before.tif','ndvi-before.png'})
            self.assertEqual((path/'ndvi-before.tif').read_bytes(),b'fixture')

    def test_unreferenced_file_and_unsafe_names_fail_closed(self):
        for unsafe in (False,True):
            with tempfile.TemporaryDirectory() as root:
                path=Path(root)
                def bad(*args):
                    views=self.fixture(*args)
                    if unsafe:views[0]['files']['before']['raster']='../request.json'
                    else:(Path(args[-1])/'unreferenced.tif').write_bytes(b'partial')
                    return views
                with patch('service.observatory.views._export_comparison',side_effect=bad):
                    with self.assertRaises(ValueError):export_comparison({}, {}, {}, {}, path)
                self.assertFalse(list(path.iterdir()))

    def test_failed_move_removes_only_new_files_and_preserves_existing(self):
        with tempfile.TemporaryDirectory() as root,patch('service.observatory.views._export_comparison',side_effect=self.fixture):
            path=Path(root);existing=path/'ndvi-before.tif';existing.write_bytes(b'original')
            # Alphabetic PNG moves first; the existing TIFF blocks the second.
            with self.assertRaises(ValueError):export_comparison({}, {}, {}, {}, path)
            self.assertEqual({p.name for p in path.iterdir()},{'ndvi-before.tif'})
            self.assertEqual(existing.read_bytes(),b'original')


if __name__=='__main__':unittest.main()

import unittest
from service.observatory.sources import source_registry

class SourcesTests(unittest.TestCase):
    def test_registry_truthful_capabilities(self):
        sources=source_registry();self.assertEqual(len(sources),len({s['id'] for s in sources}))
        for source in sources:
            self.assertEqual(set(source),{'id','title','domains','url','description','spatialSupport','access','capabilities','limitations','status'})
            self.assertTrue(source['limitations']);self.assertTrue(source['url'].startswith('https://'))
            self.assertIn(source['status'],('available','configuration_required','research','unsupported'))
        by_id={s['id']:s for s in sources}
        self.assertEqual(by_id['nlcd-histories']['status'],'unsupported')
        self.assertEqual(by_id['opera-dswx-s1']['status'],'unsupported')
        self.assertEqual(by_id['nex-gddp']['status'],'research')
        self.assertNotIn('windowed reads',by_id['hls-ndvi-ndmi']['capabilities'])
        self.assertIn('authenticated-quality-masked-index-crops',by_id['hls-ndvi-ndmi']['capabilities'])
        self.assertIn('authenticated-quality-masked-water-crops',by_id['opera-dswx-hls']['capabilities'])
        self.assertIn('sentinel-2-c1-l2a',by_id['sentinel-2-indices']['url'])
        self.assertEqual({d for s in sources if s['status']=='available' for d in s['domains']},{'water','fire','ecology','urban'})

if __name__=='__main__':unittest.main()

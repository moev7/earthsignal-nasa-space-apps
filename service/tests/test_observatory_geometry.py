import unittest
from service.observatory.geometry import validate_geometry,contains,search_boxes,spherical_area_km2

def box(w,s,e,n):return [[w,s],[e,s],[e,n],[w,n],[w,s]]

class GeometryTests(unittest.TestCase):
    def test_holes_and_multipolygons(self):
        area={'type':'MultiPolygon','coordinates':[[box(0,0,3,3),box(1,1,2,2)],[box(5,0,6,1)]]}
        validate_geometry(area);self.assertTrue(contains(area,.5,.5));self.assertFalse(contains(area,1.5,1.5));self.assertTrue(contains(area,5.5,.5))
        self.assertGreater(spherical_area_km2(area),0)
    def test_antimeridian_split_and_membership(self):
        area={'type':'Polygon','coordinates':[box(179,0,-179,2)]}
        self.assertEqual(search_boxes(area),[[179,0,180,2],[-180,0,-179,2]])
        self.assertTrue(contains(area,179.5,1));self.assertTrue(contains(area,-179.5,1));self.assertFalse(contains(area,0,1))
    def test_invalid_topology_and_values(self):
        cases=[{'type':'Polygon','coordinates':[]},{'type':'Polygon','coordinates':[[[0,0],[2,2],[0,2],[2,0],[0,0]]]},{'type':'Polygon','coordinates':[box(0,0,2,2),box(3,3,4,4)]},{'type':'Polygon','coordinates':[[[0,0],[float('nan'),1],[2,2],[0,0]]]},{'type':'Polygon','coordinates':[[[0,0],[True,1],[2,2],[0,0]]]}]
        for area in cases:
            with self.subTest(area=area),self.assertRaises(ValueError):validate_geometry(area)

if __name__=='__main__':unittest.main()

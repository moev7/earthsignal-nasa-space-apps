"""Recorded WGS84 AOIs; topology checked before provider requests."""
import math
from ..assessment_validation import validate_geometry, inside, on_segment, shift_ring

def polygons(area):
    validate_geometry(area)
    result=[]
    for polygon in ([area['coordinates']] if area['type']=='Polygon' else area['coordinates']):
        rings=[]
        for ring in polygon:
            points=[]
            for x,y in ring:
                if points:x+=360*round((points[-1][0]-x)/360)
                points.append((x,y))
            rings.append(shift_ring(points,rings[0][0][0]) if rings else points)
        result.append(rings)
    return result

def search_boxes(area):
    boxes=[]
    for p in polygons(area):
        w,e=min(x for x,y in p[0]),max(x for x,y in p[0]);s,n=min(y for x,y in p[0]),max(y for x,y in p[0])
        shift=360*math.floor((w+180)/360);w-=shift;e-=shift
        if e>180:boxes.extend([[w,s,180,n],[-180,s,e-360,n]])
        else:boxes.append([w,s,e,n])
    return boxes

def contains(area,lon,lat):
    for p in polygons(area):
        x=lon+360*round((p[0][0][0]-lon)/360)
        if inside((x,lat),p[0]) and not any(inside((x,lat),h) or any(on_segment(a,b,(x,lat)) for a,b in zip(h,h[1:])) for h in p[1:]):return True
    return False

def spherical_area_km2(area):
    """Spherical scenario footprint estimate; never a classified pixel total."""
    total=0.
    for p in polygons(area):
        for i,r in enumerate(p):
            size=abs(sum(math.radians(b[0]-a[0])*(math.sin(math.radians(a[1]))+math.sin(math.radians(b[1]))) for a,b in zip(r,r[1:])))*6371.0088**2/2
            total+=size if i==0 else -size
    return total

def unwrapped_geojson(area,anchor=None):
    rings=polygons(area)
    if anchor is None:anchor=rings[0][0][0][0]
    return {'type':'MultiPolygon','coordinates':[[[[x,y] for x,y in shift_ring(r,anchor)] for r in p] for p in rings]}

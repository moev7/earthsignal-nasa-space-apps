"""Reproduce a small OPERA GitHub raster example; no credentials or raw-scene download.

Method follows the OPERA reservoir notebook's categorical-pixel-area approach.
Counts use native 30 m UTM pixels; rendering reprojects via nearest-neighbour.
Unknown flags remain excluded, not water. No lake boundary or change inference.
"""
import argparse, base64, hashlib, json, urllib.request
from datetime import datetime, timezone
from pathlib import Path
import numpy as np
import rasterio
from rasterio.warp import calculate_default_transform, reproject, transform_bounds, Resampling
from PIL import Image

COMMIT = "452c0145b1dbdd5ca82c6d13d7fadc8fba0bbd06"
BLOB = "65ae6cbb470346bdd64a499a7ea881169c243a6f"
REPO = "OPERA-Cal-Val/OPERA_Applications"
ASSET = "DSWx/Reservoir/data/B01_mosaics/2023/20230331.tif"
NOTEBOOK = "DSWx/Reservoir/Reservoir_Monitoring.ipynb"

def read_source(local=None):
    if local:
        raw = Path(local).read_bytes()
    else:
        url = f"https://api.github.com/repos/{REPO}/contents/{ASSET}?ref={COMMIT}"
        with urllib.request.urlopen(urllib.request.Request(url, headers={"Accept":"application/vnd.github+json"}), timeout=30) as response:
            data = json.load(response)
        raw = base64.b64decode(data["content"])
    actual = hashlib.sha1(f"blob {len(raw)}\0".encode() + raw).hexdigest()
    if actual != BLOB:
        raise ValueError("Source differs from pinned GitHub raster; refuse processing")
    return raw

def summarize(data, transform):
    pixel_m2 = abs(transform.a * transform.e - transform.b * transform.d)
    values, counts = np.unique(data, return_counts=True)
    result = {str(int(v)): {"pixels":int(n), "areaKm2":float(n * pixel_m2 / 1_000_000)} for v,n in zip(values, counts)}
    assert sum(item["pixels"] for item in result.values()) == data.size
    return pixel_m2, result

def process(output, local=None):
    output=Path(output);output.mkdir(parents=True,exist_ok=True)
    raw=read_source(local); source=output/"lake-mead-water.tif";source.write_bytes(raw)
    with rasterio.open(source) as raster:
        if not raster.crs or not raster.crs.is_projected or raster.crs.linear_units != "metre":
            raise ValueError("Area method requires a projected CRS in metres")
        pixels=raster.read(1)
        pixel_m2,counts=summarize(pixels,raster.transform)
        bounds=list(raster.bounds)
        native_crs=str(raster.crs)
        shape=list(raster.shape)
        resolution=list(raster.res)
        transform,width,height=calculate_default_transform(raster.crs,"EPSG:3857",raster.width,raster.height,*raster.bounds)
        ratio=min(1,1200/max(width,height));width=max(1,int(width*ratio));height=max(1,int(height*ratio));transform=transform*rasterio.Affine.scale(1/ratio,1/ratio)
        display=np.full((height,width),255,dtype=np.uint8)
        reproject(rasterio.band(raster,1),display,src_transform=raster.transform,src_crs=raster.crs,dst_transform=transform,dst_crs="EPSG:3857",src_nodata=255,dst_nodata=255,resampling=Resampling.nearest)
        display_bounds=rasterio.transform.array_bounds(height,width,transform)
        geo_bounds=transform_bounds("EPSG:3857","EPSG:4326",*display_bounds)
    rgba=np.zeros((height,width,4),dtype=np.uint8)
    rgba[display==1]=[91,198,255,225]
    rgba[display==2]=[179,248,76,225]
    Image.fromarray(rgba).save(output/"lake-mead-water.png",optimize=True)
    total=int(pixels.size);included=sum(counts.get(str(i),{}).get("pixels",0) for i in [0,1,2])
    manifest={"schemaVersion":"1.0","id":"opera-water-20230331","title":"Lake Mead region","product":"OPERA DSWx-HLS B01 mosaic","sensorFamily":"Optical · Landsat / Sentinel-2","date":"2023-03-31","dateBasis":"Date from the repository mosaic filename; individual contributing granules are not embedded in this raster.","maturity":"Historical repository example; notebook describes provisional products","source":{"repository":f"https://github.com/{REPO}","url":f"https://github.com/{REPO}/blob/{COMMIT}/{ASSET}","notebook":f"https://github.com/{REPO}/blob/{COMMIT}/{NOTEBOOK}","commit":COMMIT,"blobSha":BLOB,"sha256":hashlib.sha256(raw).hexdigest(),"license":"Apache-2.0 (repository)"},"processing":{"method":"Native projected pixel counts × absolute affine pixel area; no resampling before counting. Classes 0, 1, 2 included; all other values excluded. No reservoir boundary applied.","processedAt":datetime.now(timezone.utc).isoformat(),"software":{"rasterio":rasterio.__version__,"numpy":np.__version__},"nativeCrs":native_crs,"resolutionMetres":resolution,"pixelAreaM2":pixel_m2,"shape":shape,"nativeBounds":bounds,"displayCrs":"EPSG:3857","displayResampling":"nearest","displaySize":[width,height]},"classes":counts,"includedPixels":included,"totalPixels":total,"includedCoveragePercent":included/total*100,"openWaterClassAreaKm2":counts.get("1",{}).get("areaKm2",0),"class2AreaKm2":counts.get("2",{}).get("areaKm2",0),"imageBounds":[[geo_bounds[1],geo_bounds[0]],[geo_bounds[3],geo_bounds[2]]],"imageUrl":"/data/lake-mead-water.png","rasterUrl":"/data/lake-mead-water.tif","caveat":"Areas describe class footprints across the entire supplied mosaic, not Lake Mead alone. Class 2 is not converted into an exact subpixel water area. Excluded codes are not interpreted as water. One historical mosaic cannot establish water-level change, flooding, volume, or current conditions."}
    (output/"processed-water.json").write_text(json.dumps(manifest,indent=2)+"\n")
    print(json.dumps({"class1AreaKm2":manifest["openWaterClassAreaKm2"],"class2AreaKm2":manifest["class2AreaKm2"],"nativeCrs":native_crs,"includedCoveragePercent":manifest["includedCoveragePercent"],"sha256":manifest["source"]["sha256"],"pngBytes":(output/"lake-mead-water.png").stat().st_size}))
    return manifest

if __name__=="__main__":
    parser=argparse.ArgumentParser();parser.add_argument("--output",default="public/data");parser.add_argument("--source",help="Existing raster; still verified against pinned Git blob")
    args=parser.parse_args();process(args.output,args.source)

"""Microsoft Planetary Computer adapter for Landsat C2 L2."""
from urllib.parse import urlencode, urlsplit, parse_qsl
from datetime import datetime, timezone
from .providers import bundle, search_boxes, box_geometry, evidence, digest, finding
from service.assessment_validation import validate_geometry
from .net import ProviderError
import re

ASSET_HOST = 'landsateuwest.blob.core.windows.net'
ASSET_PREFIX = '/landsat-c2/level-2/standard/oli-tirs/'

def canonical_asset(url):
    try:
        p = urlsplit(url)
        if (p.scheme != 'https' or p.netloc != ASSET_HOST or p.fragment or
            not p.path.startswith(ASSET_PREFIX) or not p.path.endswith('.TIF') or
            '%' in p.path or '..' in p.path or len(url) > 8192 or any(ord(c)<32 for c in url)):
            raise ValueError()
        return p.scheme+'://'+p.netloc+p.path
    except (ValueError,TypeError):
        raise ProviderError('unsafe_asset') from None

def validate_signed_asset(url):
    canonical_asset(url)
    pairs=parse_qsl(urlsplit(url).query,keep_blank_values=True)
    q=dict(pairs)
    if len(pairs)!=len(q) or not {'se','sp','sig'} <= q.keys() or not q['sig'] or set(q['sp'])-set('rl') or 'r' not in q['sp']:
        raise ProviderError('unsafe_sas_token')
    if q.get('spr','https') != 'https': raise ProviderError('unsafe_sas_token')
    try:
        expiry=datetime.fromisoformat(q['se'].replace('Z','+00:00'))
        if expiry.tzinfo is None: raise ValueError()
    except ValueError: raise ProviderError('invalid_sas_expiry') from None
    if expiry <= datetime.now(timezone.utc): raise ProviderError('expired_token')
    return url


PC_STAC = 'https://planetarycomputer.microsoft.com/api/stac/v1'
PC_SAS = 'https://planetarycomputer.microsoft.com/api/sas/v1/sign'

def discover(request, budget):
    out = bundle()
    collection = 'landsat-c2-l2'
    source = 'landsat-pc-lst'
    boxes = search_boxes(request['area'])
    items = {}

    if len(boxes) > 2:
        out['missing'].append('STAC searches the first two disjoint component boxes only; remaining components are unsearched.')

    for box in boxes[:2]:
        for ordering in ('+properties.datetime', '-properties.datetime'):
            t = budget.fetch(PC_STAC + '/search?' + urlencode({
                'collections': collection,
                'bbox': ','.join(map(str, box)),
                'datetime': request['start'] + 'T00:00:00Z/' + request['end'] + 'T23:59:59Z',
                'limit': 2,
                'sortby': ordering
            }))
            d = t.json()
            if not isinstance(d.get('features'), list) or len(d['features']) > 2:
                raise ProviderError('invalid_stac_response')

            for item in d['features']:
                if item.get('collection') != collection or not isinstance(item.get('id'), str):
                    continue
                p = item.get('properties', {})
                observed = p.get('datetime')
                if not isinstance(observed, str) or not request['start'] <= observed[:10] <= request['end']:
                    continue
                items[item['id']] = (item, t)

    selected = sorted(items.values(), key=lambda x: (x[0]['properties']['datetime'], x[0]['id']))
    if len(selected) > 4:
        selected = selected[:2] + selected[-2:]

    for item, t in selected:
        p = item['properties']
        version = p.get('landsat:collection_number')
        if version != '02' or p.get('platform') not in ('landsat-8','landsat-9') or p.get('landsat:correction') != 'L2SP' or not p.get('landsat:wrs_path') or not p.get('landsat:wrs_row'):
            out['missing'].append('Catalogue item lacks a verified processing/collection version.')
            continue

        try:
            footprint = item.get('geometry')
            validate_geometry(footprint)
        except (ValueError, TypeError, KeyError):
            footprint = box_geometry(item.get('bbox', [0, 0, 0, 0]))

        e = evidence(
            source,
            collection + ':' + str(version),
            item['id'],
            t,
            key=[item['id'], digest(item)],
            geometry=footprint,
            start=p['datetime'],
            end=p['datetime'],
            resolution=30,
            notes=[
                'Catalogue metadata and cloud percentage are not AOI valid-pixel coverage.',
                f'Platform: {p.get("platform", "unknown")}; pathrow: {p.get("landsat:wrs_path","")}/{p.get("landsat:wrs_row","")}.'
            ],
            published=p.get('created'),
            public=False
        )
        e['hashes']['item'] = digest(item)
        out['evidence'].append(e)

        out['findings'].append(finding(
            f'The catalogue identifies {item["id"]}, acquired {p["datetime"][:10]}, in {collection} processing version {version}. Its footprint intersects a search box; discovery alone does not establish usable pixels or change within the selected area.',
            [e['id']],
            observed=True,
            section='unknown',
            applicability=['Source catalogue record only, not an AOI observation.']
        ))

        keys = {'temperature': 'lwir11', 'qa': 'qa_pixel'}
        assets = {}
        try:
            for name, key in keys.items():
                asset = item['assets'][key]
                href = asset['href']
                if canonical_asset(href) != href: raise ProviderError('asset_has_query')
                if not href.startswith('https://'):
                    raise ProviderError('asset_not_https')
                if '?' in href:
                    raise ProviderError('asset_has_query')

                band = asset.get('raster:bands', [{}])[0]

                if name == 'temperature':
                    scale = band.get('scale')
                    offset = band.get('offset')
                    if scale is None or offset is None or abs(scale - 0.00341802) > 1e-8 or offset != 149 or band.get('unit') != 'kelvin':
                        raise ProviderError('calibration_mismatch')

                assets[name] = {'href': href, **{k: band[k] for k in ('scale', 'offset', 'nodata') if k in band}}

            for name,key,unit in [('st_qa','qa','kelvin'),('cloud_distance','cdist','kilometer'),('radsat','qa_radsat','bit index')]:
                asset=item['assets'].get(key)
                if asset is None:
                    e['quality']['notes'].append(name+' ancillary quality is absent; this source check is unavailable.')
                    continue
                href=asset['href'];band=asset.get('raster:bands',[{}])[0]
                if canonical_asset(href)!=href:raise ProviderError('asset_has_query')
                if band.get('unit')!=unit:raise ProviderError('ancillary_unit_mismatch')
                if name!='radsat' and (band.get('scale')!=.01 or band.get('offset',0)!=0):raise ProviderError('ancillary_calibration_mismatch')
                assets[name]={'href':href,**{k:band[k] for k in ('nodata',) if k in band}}
                if name!='radsat':assets[name].update(scale=.01,offset=0)

            e['quality']['notes'].append('Unsigned source assets: '+ '; '.join(name+'='+a['href'] for name,a in assets.items()))
            out['candidates'].append(dict(kind='landsat', sourceId=source, evidenceId=e['id'], assets=assets,
                itemId=item['id'],date=p['datetime'],version=version,platform=p['platform'],
                grid=str(p['landsat:wrs_path'])+'/'+str(p['landsat:wrs_row']),signer='planetary'))
        except KeyError:
            out['missing'].append(f"Missing assets for {item['id']}")
            continue

    return out

def sign_assets(candidate, budget):
    new_assets = {}
    for name, asset in candidate['assets'].items():
        href = asset['href']
        url = PC_SAS + '?' + urlencode({'href': href})
        t = budget.fetch(url)
        d = t.json()
        signed_url = d.get('href')

        if not signed_url:
            raise ProviderError('no_signed_url')

        if canonical_asset(href) != href or canonical_asset(signed_url) != href:
            raise ProviderError('signed_url_mismatch')
        validate_signed_asset(signed_url)
        new_assets[name] = {**asset, 'href': signed_url}

    return new_assets

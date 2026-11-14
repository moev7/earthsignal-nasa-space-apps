from dataclasses import dataclass
from pathlib import Path
import os

@dataclass(frozen=True)
class Config:
    root: Path
    secret: bytes
    netrc: Path = Path('/etc/earthsignal/earthdata.netrc')
    max_pixels: int = 1_000_000
    queue_limit: int = 8
    owner_outstanding: int = 2
    owner_daily: int = 5
    wall_seconds: int = 1200
    transfer_bytes: int = 512 * 1024**2
    artifact_bytes: int = 8 * 1024**2
    job_reservation_bytes: int = 96 * 1024**2
    storage_bytes: int = 1024**3
    reserve_bytes: int = 3 * 1024**3
    expiry_seconds: int = 7 * 86400
    lease_seconds: int = 60
    assessment_domains: tuple[str, ...] = ('water', 'fire', 'ecology', 'urban')
    scenarios_enabled: bool = True
    gauge_vintages_enabled: bool = False
    area_experiments_enabled: bool = False

    @classmethod
    def environment(cls):
        secret = os.environ.get('EARTHSIGNAL_GATEWAY_SECRET', '').encode()
        if len(secret) < 32:
            raise RuntimeError('EARTHSIGNAL_GATEWAY_SECRET must contain at least 32 bytes')
        def bounded(name, default, minimum, maximum):
            raw = os.environ.get('EARTHSIGNAL_'+name, str(default))
            try:
                value = int(raw)
            except ValueError:
                raise RuntimeError('Invalid limit '+name) from None
            if not minimum <= value <= maximum:
                raise RuntimeError('Limit outside safe bounds: '+name)
            return value
        domains = tuple(filter(None, os.environ.get('EARTHSIGNAL_ASSESSMENT_DOMAINS', '').split(',')))
        if len(set(domains)) != len(domains) or any(d not in ('water','fire','ecology','urban') for d in domains):
            raise RuntimeError('Invalid enabled assessment domains')
        vintages = os.environ.get('EARTHSIGNAL_GAUGE_VINTAGES_ENABLED','true')
        if vintages not in ('true','false'): raise RuntimeError('Invalid gauge vintage feature flag')
        scenarios = os.environ.get('EARTHSIGNAL_SCENARIOS_ENABLED','false')
        if scenarios not in ('true','false'): raise RuntimeError('Invalid scenario feature flag')
        area = os.environ.get('EARTHSIGNAL_AREA_EXPERIMENTS_ENABLED','false')
        if area not in ('true','false'): raise RuntimeError('Invalid area experiment feature flag')
        return cls(root=Path(os.environ.get('EARTHSIGNAL_DATA_DIR', '/var/lib/earthsignal')),
            secret=secret, netrc=Path(os.environ.get('EARTHSIGNAL_NETRC', '/etc/earthsignal/earthdata.netrc')),
            max_pixels=bounded('MAX_PIXELS',1_000_000,1,1_000_000),
            queue_limit=bounded('QUEUE_LIMIT',8,1,8),
            owner_outstanding=bounded('OWNER_OUTSTANDING',2,1,2),
            owner_daily=bounded('OWNER_DAILY',5,1,5),
            wall_seconds=bounded('WALL_SECONDS',1200,1,1200),
            transfer_bytes=bounded('TRANSFER_BYTES',512*1024**2,1,512*1024**2),
            storage_bytes=bounded('STORAGE_BYTES',1024**3,96*1024**2+1,1024**3),
            reserve_bytes=bounded('RESERVE_BYTES',3*1024**3,3*1024**3,1024**4),
            expiry_seconds=bounded('EXPIRY_SECONDS',7*86400,1,7*86400),
            lease_seconds=bounded('LEASE_SECONDS',60,5,60), assessment_domains=domains, scenarios_enabled=scenarios=='true',gauge_vintages_enabled=vintages=='true',area_experiments_enabled=area=='true')

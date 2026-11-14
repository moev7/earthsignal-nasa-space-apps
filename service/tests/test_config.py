import os
import unittest
from unittest.mock import patch
from service.config import Config

class ConfigTests(unittest.TestCase):
    def test_environment_override_and_hard_limits(self):
        with patch.dict(os.environ,{'EARTHSIGNAL_GATEWAY_SECRET':'s'*32,'EARTHSIGNAL_MAX_PIXELS':'123','EARTHSIGNAL_QUEUE_LIMIT':'3'},clear=True):
            config=Config.environment()
            self.assertEqual((config.max_pixels,config.queue_limit),(123,3))
            for name,value in [('TRANSFER_BYTES','536870913'),('QUEUE_LIMIT','9'),('OWNER_DAILY','6'),('WALL_SECONDS','1201'),('MAX_PIXELS','1000001'),('RESERVE_BYTES','1'),('EXPIRY_SECONDS','604801'),('STORAGE_BYTES','1073741825'),('OWNER_OUTSTANDING','3'),('LEASE_SECONDS','0')]:
                with patch.dict(os.environ,{'EARTHSIGNAL_'+name:value}):
                    with self.assertRaises(RuntimeError):Config.environment()
    def test_gauge_vintage_flag_is_explicit_and_bounded(self):
        with patch.dict(os.environ,{'EARTHSIGNAL_GATEWAY_SECRET':'s'*32},clear=True):
            self.assertTrue(Config.environment().gauge_vintages_enabled)
            with patch.dict(os.environ,{'EARTHSIGNAL_GAUGE_VINTAGES_ENABLED':'false'}):
                self.assertFalse(Config.environment().gauge_vintages_enabled)
            with patch.dict(os.environ,{'EARTHSIGNAL_GAUGE_VINTAGES_ENABLED':'yes'}):
                with self.assertRaises(RuntimeError):Config.environment()
    def test_secret_required(self):
        with patch.dict(os.environ,{},clear=True):
            with self.assertRaises(RuntimeError):Config.environment()

if __name__=='__main__':unittest.main()

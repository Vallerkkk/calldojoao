import os
import sys
import threading
import time
import types
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from uuid import uuid4

import httpx
from fastapi.testclient import TestClient

import app
from test_app import ENV


class ProviderError(Exception):
    def __init__(self, status):
        self.response = types.SimpleNamespace(status_code=status)


class PushDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.uid = str(uuid4())
        self.finishes = []
        self.jobs = []
        self.environment = patch.dict(os.environ, {**ENV, 'PUSH_TRANSPORT_KEY': 'test-only-transport', 'VAPID_PRIVATE_KEY': 'test-only-private'})
        self.environment.start()
        self.provider = types.ModuleType('pywebpush')
        self.provider.webpush = lambda **kwargs: None
        self.provider.WebPushException = ProviderError
        self.modules = patch.dict(sys.modules, {'pywebpush': self.provider})
        self.modules.start()

        async def request(_client, method, url, **kwargs):
            if url.endswith('/auth/v1/user'):
                return httpx.Response(200, json={'id': self.uid})
            if url.endswith('/rpc/push_take'):
                return httpx.Response(200, json=self.jobs)
            if url.endswith('/rpc/push_finish'):
                self.finishes.append(kwargs['json'])
                return httpx.Response(200, json=True)
            raise AssertionError('Unexpected upstream operation')
        self.remote = patch.object(httpx.AsyncClient, 'request', request)
        self.remote.start()

    def tearDown(self):
        self.remote.stop()
        self.modules.stop()
        self.environment.stop()

    def job(self, number):
        return {'job_id': str(number // 4), 'subscription_id': str(number), 'endpoint': 'https://fcm.googleapis.com/fcm/send/test-' + str(number), 'p256dh': 'test', 'auth': 'test', 'payload': {'body': 'test'}}

    def dispatch(self, client):
        return client.post('/api/notifications/dispatch', headers={'Authorization': 'Bearer test'})

    def test_provider_concurrency_is_bounded(self):
        self.jobs = [self.job(index) for index in range(20)]
        lock = threading.Lock()
        active = peak = 0
        def deliver(**kwargs):
            nonlocal active, peak
            with lock:
                active += 1
                peak = max(peak, active)
            time.sleep(0.015)
            with lock:
                active -= 1
        self.provider.webpush = deliver
        with TestClient(app.app) as client:
            response = self.dispatch(client)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['sent'], 20)
        self.assertLessEqual(peak, 10)
        self.assertEqual(len(self.finishes), 5)
        self.assertTrue(response.json()['retry'])

    def test_expired_device_is_removed_without_retrying_it(self):
        self.jobs = [self.job(0)]
        def expired(**kwargs):
            raise ProviderError(410)
        self.provider.webpush = expired
        with TestClient(app.app) as client:
            response = self.dispatch(client)
        self.assertEqual(response.json()['sent'], 0)
        self.assertFalse(response.json()['retry'])
        self.assertEqual(self.finishes[0]['expired'], '0')

    def test_temporary_provider_error_keeps_the_job_retryable(self):
        self.jobs = [self.job(0)]
        def unavailable(**kwargs):
            raise ProviderError(503)
        self.provider.webpush = unavailable
        with TestClient(app.app) as client:
            response = self.dispatch(client)
        self.assertTrue(response.json()['retry'])
        self.assertFalse(self.finishes[-1]['success'])

    def test_overlapping_dispatch_does_not_duplicate_delivery(self):
        self.jobs = [self.job(0)]
        entered, release = threading.Event(), threading.Event()
        def blocked(**kwargs):
            entered.set()
            release.wait(5)
        self.provider.webpush = blocked
        with TestClient(app.app) as client, ThreadPoolExecutor(max_workers=1) as pool:
            first = pool.submit(self.dispatch, client)
            try:
                self.assertTrue(entered.wait(3))
                second = self.dispatch(client)
                self.assertEqual(second.json()['sent'], 0)
                self.assertTrue(second.json()['retry'])
            finally:
                release.set()
            self.assertEqual(first.result(timeout=5).json()['sent'], 1)

    def test_oversized_push_key_is_rejected_before_storage(self):
        with TestClient(app.app) as client:
            response = client.post('/api/push/subscribe', headers={'Authorization': 'Bearer test'}, json={'endpoint': 'https://fcm.googleapis.com/fcm/send/test', 'keys': {'auth': 'A' * 1000, 'p256dh': 'A' * 87}})
        self.assertEqual(response.status_code, 400)

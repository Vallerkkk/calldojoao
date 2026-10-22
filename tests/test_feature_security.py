import unittest
from community_features import valid_push_endpoint, MemberAction
from pydantic import ValidationError


class FeatureSecurityTests(unittest.TestCase):
    def test_push_destination_is_a_known_provider(self):
        self.assertTrue(valid_push_endpoint('https://fcm.googleapis.com/fcm/send/example'))
        self.assertTrue(valid_push_endpoint('https://updates.push.services.mozilla.com/wpush/v2/example'))
        for endpoint in ['http://fcm.googleapis.com/x','https://fcm.googleapis.com.evil.test/x','https://127.0.0.1/x',
                         'https://fcm.googleapis.com:8443/x','https://evil.test@fcm.googleapis.com/x','https://169.254.169.254/']:
            self.assertFalse(valid_push_endpoint(endpoint),endpoint)

    def test_moderation_duration_is_bounded(self):
        for value in (0,40321):
            with self.assertRaises(ValidationError):
                MemberAction(member='11111111-1111-4111-8111-111111111111',action='timeout',minutes=value)


if __name__=='__main__':
    unittest.main()

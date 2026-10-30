from rest_framework.throttling import AnonRateThrottle


class SchoolLookupThrottle(AnonRateThrottle):
    """Caps the public school search and code lookup per client, so the school list cannot be scraped
    by calling them in a loop.

    The rate lives on the class, not in REST_FRAMEWORK['DEFAULT_THROTTLE_RATES']: the test settings
    empty that table, and a scope missing from it makes DRF refuse the request outright.
    """
    scope = 'school_lookup'
    rate = '30/minute'

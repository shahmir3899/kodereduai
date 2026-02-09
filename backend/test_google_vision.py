"""
Test script to verify Google Cloud Vision API key.
Run: python test_google_vision.py
"""

import os
import sys
import json
import base64
import requests

# Load API key from .env or environment
from dotenv import load_dotenv
load_dotenv()

API_KEY = os.getenv('GOOGLE_VISION_API_KEY', '')

def test_vision_api():
    """Test the Vision API with a simple image."""

    print("=" * 60)
    print("Google Cloud Vision API Test")
    print("=" * 60)

    if not API_KEY:
        print("\n❌ ERROR: GOOGLE_VISION_API_KEY not set in .env file")
        return False

    print(f"\n✓ API Key found: {API_KEY[:10]}...{API_KEY[-4:]}")

    # Create a tiny test image (1x1 white pixel PNG)
    # This is base64-encoded minimal valid PNG
    test_image_base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

    url = f"https://vision.googleapis.com/v1/images:annotate?key={API_KEY}"

    payload = {
        "requests": [{
            "image": {"content": test_image_base64},
            "features": [{"type": "TEXT_DETECTION"}]
        }]
    }

    print(f"\n📤 Sending request to: {url[:50]}...")
    print(f"   Payload size: {len(json.dumps(payload))} bytes")

    try:
        response = requests.post(url, json=payload, timeout=30)

        print(f"\n📥 Response Status: {response.status_code}")

        try:
            result = response.json()
        except:
            result = {"raw_response": response.text[:1000]}

        if response.status_code == 200:
            print("\n✅ SUCCESS! API key is working correctly.")
            print("\nResponse preview:")
            print(json.dumps(result, indent=2)[:500])
            return True
        else:
            print(f"\n❌ FAILED with status {response.status_code}")

            error_info = result.get('error', {})
            if error_info:
                print("\n🔍 Error Details:")
                print(f"   Code: {error_info.get('code', 'N/A')}")
                print(f"   Status: {error_info.get('status', 'N/A')}")
                print(f"   Message: {error_info.get('message', 'N/A')}")

                # Parse detailed error info
                details = error_info.get('details', [])
                if details:
                    print("\n   Additional Details:")
                    for detail in details:
                        print(f"   - {detail}")
            else:
                print("\n   Raw response:")
                print(f"   {response.text[:500]}")

            # Common solutions based on error
            print("\n" + "=" * 60)
            print("💡 COMMON SOLUTIONS:")
            print("=" * 60)

            if response.status_code == 403:
                print("""
1. Check API Key Restrictions in Google Cloud Console:
   - Go to: https://console.cloud.google.com/apis/credentials
   - Click on your API key
   - Under "API restrictions", either:
     a) Select "Don't restrict key" (for testing)
     b) Or add "Cloud Vision API" to allowed APIs

2. Check Application Restrictions:
   - If set to "IP addresses", add your server's IP
   - If set to "None", it should work from anywhere

3. Verify Cloud Vision API is enabled:
   - Go to: https://console.cloud.google.com/apis/library/vision.googleapis.com
   - Click "Enable" if not already enabled

4. Check billing is active:
   - Go to: https://console.cloud.google.com/billing
   - Ensure your project has an active billing account

5. Verify the API key belongs to the correct project:
   - The key must be from the same project where Vision API is enabled
""")
            elif response.status_code == 400:
                print("""
1. The request format may be invalid
2. Check if the image data is properly base64 encoded
""")
            elif response.status_code == 401:
                print("""
1. API key is invalid or expired
2. Generate a new API key from Google Cloud Console
""")

            return False

    except requests.RequestException as e:
        print(f"\n❌ Network error: {e}")
        return False


if __name__ == "__main__":
    success = test_vision_api()
    sys.exit(0 if success else 1)

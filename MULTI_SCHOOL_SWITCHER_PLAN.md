# Multi-School Switcher Implementation Plan

## Overview
Implement hybrid approach for users with 2+ schools:
1. **Option A**: In-app school switcher (quick access dropdown)
2. **Option B**: Multi-school landing page (centralized school selector)

---

## Phase 1: In-App School Switcher (2-3 hours)

### 1.1 Create SchoolSwitcher Component

**File**: `frontend/src/components/SchoolSwitcher.jsx`

```jsx
import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from './Toast'

export default function SchoolSwitcher() {
  const { user } = useAuth()
  const [isOpen, setIsOpen] = useState(false)
  const { showSuccess } = useToast()

  if (!user?.schools || user.schools.length < 2) {
    return null // Don't show if only 1 school
  }

  const currentSchoolId = parseInt(localStorage.getItem('currentSchoolId'))
  const currentSchool = user.schools.find(s => s.id === currentSchoolId)

  const handleSwitchSchool = (schoolId) => {
    // Store new school in localStorage
    const school = user.schools.find(s => s.id === schoolId)
    localStorage.setItem('currentSchoolId', schoolId.toString())
    localStorage.setItem('currentSchoolName', school.name)
    localStorage.setItem('currentSchoolSubdomain', school.subdomain)
    
    // Invalidate all queries so API calls use new school
    window.location.href = `https://${school.subdomain}.kodereduai.pk`
    showSuccess(`Switched to ${school.name}`)
    setIsOpen(false)
  }

  return (
    <div className="relative">
      {/* Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium flex items-center gap-2"
      >
        <span>📚 {currentSchool?.name || 'Select School'}</span>
        <svg className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
        </svg>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute top-full mt-2 right-0 bg-white border border-gray-200 rounded-lg shadow-lg z-50 min-w-max">
          <div className="p-2 max-h-96 overflow-y-auto">
            {user.schools.map((school) => (
              <button
                key={school.id}
                onClick={() => handleSwitchSchool(school.id)}
                className={`w-full text-left px-4 py-2 rounded-lg text-sm transition-colors ${
                  school.id === currentSchoolId
                    ? 'bg-blue-600 text-white'
                    : 'hover:bg-gray-100 text-gray-700'
                }`}
              >
                <div className="font-medium">{school.name}</div>
                <div className="text-xs opacity-75">{school.address || 'No address'}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

---

### 1.2 Update Header/Layout

**File**: `frontend/src/components/Layout.jsx` (or main dashboard header)

Find the header section and add SchoolSwitcher:

```jsx
import SchoolSwitcher from './SchoolSwitcher'

export default function Layout({ children }) {
  return (
    <div className="flex flex-col min-h-screen">
      <header className="bg-white border-b border-gray-200">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Logo />
            <SchoolSwitcher />  {/* ADD HERE */}
          </div>
          
          {/* Rest of header (user menu, notifications, etc) */}
          <UserMenu />
        </div>
      </header>
      
      <main>{children}</main>
    </div>
  )
}
```

---

### 1.3 Update API Headers

**File**: `frontend/src/services/api.js`

Ensure all API calls send `X-School-ID` header with current school:

```javascript
// Add interceptor to include school ID in all requests
instance.interceptors.request.use((config) => {
  const schoolId = localStorage.getItem('currentSchoolId')
  if (schoolId) {
    config.headers['X-School-ID'] = schoolId
  }
  return config
})
```

---

## Phase 2: Multi-School Landing Page (3-4 hours)

### 2.1 Create Landing Page Component

**File**: `frontend/src/pages/MultiSchoolLanding.jsx`

```jsx
import { useEffect, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useNavigate } from 'react-router-dom'
import LoadingSpinner from '../components/LoadingSpinner'
import { useToast } from '../components/Toast'

export default function MultiSchoolLanding() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const { showError } = useToast()
  const [selectedSchoolId, setSelectedSchoolId] = useState(null)

  useEffect(() => {
    if (!loading && !user) {
      navigate('/login')
      return
    }

    // If user has only 1 school, redirect directly
    if (user?.schools?.length === 1) {
      const school = user.schools[0]
      localStorage.setItem('currentSchoolId', school.id.toString())
      localStorage.setItem('currentSchoolName', school.name)
      window.location.href = `https://${school.subdomain}.kodereduai.pk`
    }
  }, [user, loading, navigate])

  const handleSchoolSelect = (school) => {
    setSelectedSchoolId(school.id)
    localStorage.setItem('currentSchoolId', school.id.toString())
    localStorage.setItem('currentSchoolName', school.name)
    localStorage.setItem('currentSchoolSubdomain', school.subdomain)
    
    // Redirect to school subdomain
    setTimeout(() => {
      window.location.href = `https://${school.subdomain}.kodereduai.pk`
    }, 300)
  }

  if (loading) {
    return <LoadingSpinner />
  }

  if (!user || user.schools.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-red-600 mb-4">No schools assigned to your account</p>
          <button
            onClick={() => navigate('/login')}
            className="text-blue-600 hover:underline"
          >
            Back to Login
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">KoderEduAI</h1>
              <p className="text-gray-600">Select Your School</p>
            </div>
            <div className="text-right">
              <p className="text-sm text-gray-600">Welcome, <span className="font-semibold">{user.first_name}</span></p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
        <h2 className="text-2xl font-bold text-gray-900 mb-8">
          You have access to {user.schools.length} school{user.schools.length !== 1 ? 's' : ''}
        </h2>

        {/* School Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {user.schools.map((school) => (
            <div
              key={school.id}
              onClick={() => handleSchoolSelect(school)}
              className={`cursor-pointer transform transition-all hover:scale-105 ${
                selectedSchoolId === school.id ? 'ring-2 ring-blue-600' : ''
              }`}
            >
              <div className="bg-white rounded-lg shadow-lg overflow-hidden hover:shadow-xl">
                {/* School Logo/Banner */}
                <div className="h-32 bg-gradient-to-r from-blue-600 to-indigo-600 flex items-center justify-center">
                  {school.logo ? (
                    <img
                      src={school.logo}
                      alt={school.name}
                      className="h-20 w-20 object-contain"
                    />
                  ) : (
                    <div className="text-4xl text-white">🏫</div>
                  )}
                </div>

                {/* School Info */}
                <div className="p-6">
                  <h3 className="text-xl font-bold text-gray-900 mb-2">{school.name}</h3>
                  
                  {school.address && (
                    <p className="text-sm text-gray-600 mb-4">
                      📍 {school.address}
                    </p>
                  )}

                  {school.phone && (
                    <p className="text-sm text-gray-600 mb-4">
                      ☎️ {school.phone}
                    </p>
                  )}

                  {/* Metadata */}
                  <div className="border-t border-gray-200 pt-4 mt-4 grid grid-cols-2 gap-4 text-xs text-gray-600">
                    <div>
                      <div className="font-semibold text-gray-900">Students</div>
                      <div>{school.students_count || 0}</div>
                    </div>
                    <div>
                      <div className="font-semibold text-gray-900">Staff</div>
                      <div>{school.staff_count || 0}</div>
                    </div>
                  </div>

                  {/* Access Button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleSchoolSelect(school)
                    }}
                    className="w-full mt-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors"
                  >
                    {selectedSchoolId === school.id ? 'Opening...' : 'Access School'}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
```

---

### 2.2 Create Multi-School App Entry Point

**File**: `frontend/src/apps/schools/main.jsx`

```jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../../contexts/AuthContext'
import { ToastProvider } from '../../components/Toast'
import SchoolsApp from './SchoolsApp'
import '../../index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      gcTime: 5 * 60 * 1000,
      refetchOnWindowFocus: true,
      retry: 1,
    },
  },
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <SchoolsApp />
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
```

---

### 2.3 Create Schools App Wrapper

**File**: `frontend/src/apps/schools/SchoolsApp.jsx`

```jsx
import { useAuth } from '../../contexts/AuthContext'
import LoadingSpinner from '../../components/LoadingSpinner'
import LoginPage from '../../pages/LoginPage'
import MultiSchoolLanding from '../../pages/MultiSchoolLanding'

export default function SchoolsApp() {
  const { user, loading } = useAuth()

  if (loading) {
    return <LoadingSpinner />
  }

  // Not logged in → show login
  if (!user) {
    return <LoginPage isMultiSchool={true} />
  }

  // Logged in → show multi-school landing
  return <MultiSchoolLanding />
}
```

---

### 2.4 Update index.html to Support schools.kodereduai.pk

**File**: `frontend/index.html`

Update the subdomain detection logic:

```html
<script type="module">
  (function() {
    const hostname = window.location.hostname;
    const parts = hostname.split('.');
    
    let appToLoad = 'portal';
    
    if (hostname === 'portal.kodereduai.pk') {
      appToLoad = 'portal';
    } else if (hostname === 'schools.kodereduai.pk') {
      appToLoad = 'schools';  // NEW: Multi-school landing
    } else if (hostname.endsWith('.kodereduai.pk') && parts.length === 3 && parts[0] !== 'www') {
      appToLoad = 'school';
    }
    
    console.log('🎯 Detected app to load:', appToLoad, 'for hostname:', hostname);
    
    const loader = document.getElementById('subdomain-loader');
    
    if (appToLoad === 'portal') {
      import('/src/apps/portal/main.jsx').then(() => {
        if (loader) loader.style.display = 'none';
      });
    } else if (appToLoad === 'schools') {
      import('/src/apps/schools/main.jsx').then(() => {
        if (loader) loader.style.display = 'none';
      });
    } else if (appToLoad === 'school') {
      import('/src/apps/school/main.jsx').then(() => {
        if (loader) loader.style.display = 'none';
      });
    }
  })();
</script>
```

---

## Phase 3: Backend Updates (if needed)

### 3.1 Verify User Schools Endpoint

**Endpoint**: `GET /api/users/me/`

Should return:
```json
{
  "id": 5,
  "username": "teacher_multi_school",
  "first_name": "John",
  "schools": [
    {
      "id": 1,
      "name": "The Focus School - Main",
      "subdomain": "focus",
      "logo": "https://...",
      "address": "123 Main St",
      "phone": "051-123-4567",
      "students_count": 450,
      "staff_count": 45
    },
    {
      "id": 2,
      "name": "The Focus Montessori - Branch 2",
      "subdomain": "focus2",
      "logo": "https://...",
      "address": "456 Branch Rd",
      "phone": "051-234-5678",
      "students_count": 280,
      "staff_count": 28
    }
  ]
}
```

If backend is not returning `schools` array, update the serializer:

**File**: `backend/users/serializers.py`

```python
class UserSerializer(serializers.ModelSerializer):
    schools = serializers.SerializerMethodField()
    
    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'last_name', 'schools', ...]
    
    def get_schools(self, obj):
        # Get all schools user belongs to
        memberships = obj.schoolmembership_set.filter(is_active=True)
        return [
            {
                'id': m.school.id,
                'name': m.school.name,
                'subdomain': m.school.subdomain,
                'logo': m.school.logo.url if m.school.logo else None,
                'address': m.school.address,
                'phone': m.school.phone,
                'students_count': m.school.student_set.count(),
                'staff_count': m.school.staffmember_set.count(),
            }
            for m in memberships
        ]
```

---

## Testing Checklist

### Phase 1 Testing (In-App Switcher)
- [ ] Single-school user: SchoolSwitcher NOT shown
- [ ] Multi-school user: SchoolSwitcher shown in header
- [ ] Click dropdown: Shows all user's schools
- [ ] Select different school: Redirects to that subdomain
- [ ] After switch: School-specific data loads (students, staff, etc.)
- [ ] Verify API requests send correct `X-School-ID` header
- [ ] Browser back button: Doesn't go back to previous school (new domain)

### Phase 2 Testing (Landing Page)
- [ ] Visit `schools.kodereduai.pk`: Shows login (if not logged in)
- [ ] Login with multi-school user: Shows landing page
- [ ] Click school card: Redirects to that subdomain
- [ ] Visit `schools.kodereduai.pk` with single-school user: Auto-redirects to school
- [ ] School metadata shows correctly (logo, address, counts)
- [ ] Selected school shows visual feedback

### Integration Testing
- [ ] User logs in at `focus.kodereduai.pk` → can switch to `focus2` via dropdown
- [ ] User logs in at `schools.kodereduai.pk` → can select school
- [ ] User logs in at `portal.kodereduai.pk` → sees admin panel (no switcher)
- [ ] After switching schools: New school's data loads (not old data)
- [ ] Permissions respected per school

---

## File Structure After Implementation

```
frontend/
├── src/
│   ├── apps/
│   │   ├── school/
│   │   │   ├── main.jsx
│   │   │   └── SchoolApp.jsx
│   │   ├── schools/  (NEW)
│   │   │   ├── main.jsx
│   │   │   └── SchoolsApp.jsx
│   │   └── portal/
│   ├── components/
│   │   ├── SchoolSwitcher.jsx  (NEW)
│   │   └── Layout.jsx  (UPDATED)
│   ├── pages/
│   │   └── MultiSchoolLanding.jsx  (NEW)
│   └── services/
│       └── api.js  (UPDATED with interceptor)
└── index.html  (UPDATED with schools.kodereduai.pk detection)
```

---

## Implementation Timeline

| Phase | Task | Time | Priority |
|-------|------|------|----------|
| 1a | Create SchoolSwitcher component | 1h | HIGH |
| 1b | Update Layout/Header | 30min | HIGH |
| 1c | Verify API includes school ID | 30min | HIGH |
| 2a | Create MultiSchoolLanding page | 1.5h | MEDIUM |
| 2b | Create SchoolsApp entry point | 30min | MEDIUM |
| 2c | Update index.html logic | 30min | MEDIUM |
| 3 | Backend updates (if needed) | 1h | MEDIUM |
| Testing | Full QA cycle | 2h | HIGH |
| **Total** | | **~8 hours** | |

---

## Deployment Notes

1. **DNS Setup**: Ensure `schools.kodereduai.pk` points to same Hostnext server
   - Already have wildcard `*.kodereduai.pk` → covers `schools` automatically ✅

2. **Build & Upload**:
   ```bash
   npm run build
   # Upload dist/ to _wildcard_.kodereduai.pk
   ```

3. **Backwards Compatibility**: 
   - Existing single-school users unaffected
   - No breaking changes to current flows

4. **Analytics**:
   - Track school switches to understand usage patterns
   - Monitor bounce rate from landing page

---

## Success Criteria

✅ Multi-school users can switch schools without re-login  
✅ In-app switcher provides quick access  
✅ Landing page provides centralized view  
✅ All school-level data correctly filtered per school  
✅ No performance degradation  
✅ Works on all devices (responsive)  


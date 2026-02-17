# Admissions Analytics Guide

**Date**: February 16, 2026  
**Feature**: Phase 10 - Analytics for Configurable Workflows

---

## Overview

The admissions system now includes comprehensive analytics across all workflow types (SIMPLE, STANDARD, COMPLEX). Track conversion rates, fee collection, bypass usage, source performance, and much more.

---

## Analytics Endpoints

### **1. Overall School Analytics**

```bash
GET /api/admissions/analytics/overall/

Response:
{
    "overall": {
        "total_enquiries": 245,
        "enrolled": 89,
        "rejected": 32,
        "pending": 124,
        "conversion_rate": 36.33,
        "top_sources": [
            {"source": "WALK_IN", "count": 95},
            {"source": "REFERRAL", "count": 52},
            {"source": "WEBSITE", "count": 42}
        ]
    },
    "workflow_type_comparison": {
        "SIMPLE": {
            "workflow_type": "SIMPLE",
            "total_enquiries": 80,
            "enrolled": 42,
            "rejected": 12,
            "pending": 26,
            "conversion_rate": 52.5,
            "avg_days_to_enrollment": 8.3,
            "session_count": 2
        },
        "STANDARD": {
            "workflow_type": "STANDARD",
            "total_enquiries": 120,
            "enrolled": 38,
            "rejected": 15,
            "pending": 67,
            "conversion_rate": 31.67,
            "avg_days_to_enrollment": 12.1,
            "session_count": 3
        },
        "COMPLEX": {
            "workflow_type": "COMPLEX",
            "total_enquiries": 45,
            "enrolled": 9,
            "rejected": 5,
            "pending": 31,
            "conversion_rate": 20.0,
            "avg_days_to_enrollment": 28.7,
            "session_count": 1
        }
    },
    "fee_analytics": {
        "total_fee_amount": 450000.00,
        "total_collected": 380000.00,
        "collection_rate": 84.44,
        "pending_count": 45,
        "by_status": [
            {"status": "COMPLETED", "count": 89, "total_amount": 400000.00, "total_paid": 400000.00},
            {"status": "PARTIAL", "count": 32, "total_amount": 50000.00, "total_paid": 25000.00},
            {"status": "PENDING", "count": 124, "total_amount": 0.00, "total_paid": 0.00}
        ],
        "total_records": 245
    },
    "bypass_analytics": {
        "total_bypasses": 28,
        "total_enquiries_with_bypass": 18,
        "bypass_rate": 7.35,
        "by_user": [
            {"user__first_name": "John", "user__last_name": "Principal", "count": 12},
            {"user__first_name": "Mary", "user__last_name": "Admissions", "count": 10},
            {"user__first_name": "Tom", "user__last_name": "Admin", "count": 6}
        ],
        "total_enquiries": 245
    },
    "source_performance": [
        {
            "source": "WALK_IN",
            "total_enquiries": 95,
            "enrolled": 42,
            "conversion_rate": 44.21
        },
        {
            "source": "REFERRAL",
            "total_enquiries": 52,
            "enrolled": 28,
            "conversion_rate": 53.85
        },
        {
            "source": "WEBSITE",
            "total_enquiries": 42,
            "enrolled": 8,
            "conversion_rate": 19.05
        }
    ],
    "monthly_trends": [
        {
            "month": "2025-09",
            "total_enquiries": 32,
            "enrolled": 8,
            "rejected": 4,
            "conversion_rate": 25.0
        },
        {
            "month": "2025-10",
            "total_enquiries": 45,
            "enrolled": 18,
            "rejected": 6,
            "conversion_rate": 40.0
        },
        ...
    ]
}
```

---

### **2. Session-Specific Analytics**

```bash
GET /api/admissions/analytics/session/{session_id}/

Response:
{
    "session_info": {
        "id": 5,
        "name": "Admission 2025-2026",
        "workflow_type": "STANDARD",
        "start_date": "2025-10-01",
        "end_date": "2025-12-31",
        "is_active": true
    },
    "pipeline_funnel": [
        {
            "stage_key": "NEW",
            "stage_label": "New Enquiry",
            "count": 120,
            "percentage": 100.0,
            "order": 0
        },
        {
            "stage_key": "CONTACTED",
            "stage_label": "Contacted",
            "count": 98,
            "percentage": 81.67,
            "order": 1
        },
        {
            "stage_key": "FORM_SUBMITTED",
            "stage_label": "Form Submitted",
            "count": 75,
            "percentage": 62.5,
            "order": 2
        },
        {
            "stage_key": "APPROVED",
            "stage_label": "Approved",
            "count": 42,
            "percentage": 35.0,
            "order": 3
        },
        {
            "stage_key": "PAYMENT_PENDING",
            "stage_label": "Awaiting Payment",
            "count": 38,
            "percentage": 31.67,
            "order": 4
        },
        {
            "stage_key": "ENROLLED",
            "stage_label": "Final - Enrolled",
            "count": 38,
            "percentage": 31.67,
            "order": 5
        }
    ],
    "stage_conversion": [
        {
            "from_stage": "NEW",
            "from_label": "New Enquiry",
            "from_count": 120,
            "to_stage": "CONTACTED",
            "to_label": "Contacted",
            "to_count": 98,
            "conversion_rate": 81.67
        },
        {
            "from_stage": "CONTACTED",
            "from_label": "Contacted",
            "from_count": 98,
            "to_stage": "FORM_SUBMITTED",
            "to_label": "Form Submitted",
            "to_count": 75,
            "conversion_rate": 76.53
        },
        ...
    ],
    "total_enquiries": 120,
    "enrolled": 38,
    "conversion_rate": 31.67
}
```

---

## Analytics Concepts

### **1. Pipeline Funnel**

Shows the number of enquiries at each stage and percentage from start.

```
NEW (100%) → CONTACTED (81%) → FORM_SUBMITTED (62%) → 
APPROVED (35%) → PAYMENT_PENDING (31%) → ENROLLED (31%)
```

**Insights:**
- 19% drop-off from NEW to CONTACTED (follow-up issue?)
- 31% drop-off from CONTACTED to FORM_SUBMITTED (form friction?)
- Large drop from FORM_SUBMITTED to APPROVED (approval bottleneck?)

### **2. Stage-to-Stage Conversion**

Shows conversion rates between consecutive stages.

```
NEW → CONTACTED: 81.67%
CONTACTED → FORM_SUBMITTED: 76.53%
FORM_SUBMITTED → APPROVED: 56.0%
APPROVED → PAYMENT_PENDING: 90.48%
PAYMENT_PENDING → ENROLLED: 100%
```

**Insights:**
- Payment pending → Enrolled has 100% conversion (good!)
- Form submission → Approval has only 56% (biggest bottleneck)

### **3. Workflow Type Comparison**

Compares performance across SIMPLE, STANDARD, and COMPLEX workflows.

```
SIMPLE:    80 enquiries, 42 enrolled, 52.5% conversion, 8.3 days avg
STANDARD: 120 enquiries, 38 enrolled, 31.6% conversion, 12.1 days avg
COMPLEX:   45 enquiries,  9 enrolled, 20.0% conversion, 28.7 days avg
```

**Insights:**
- SIMPLE template has highest conversion rate (efficiency trade-off)
- COMPLEX takes 3.5x longer but might be for selective admissions
- STANDARD is middle ground

### **4. Fee Analytics**

Tracks fee collection status and revenue.

```
Total Fee Amount:    ₹450,000
Total Collected:     ₹380,000 (84.44%)
Pending Collection:  ₹70,000 (45 enquiries)

Status Breakdown:
- COMPLETED:  89 enquiries, ₹400,000
- PARTIAL:    32 enquiries, ₹25,000 (of ₹50,000 due)
- PENDING:   124 enquiries, ₹0
```

**Insights:**
- 84.44% collection rate is good
- Follow-up needed for 45 pending fees
- Partial payments need attention

### **5. Bypass Analytics**

Tracks use of stage bypassing feature.

```
Total Bypasses:        28 actions
Enquiries Bypassed:    18 (7.35% of all enquiries)

Bypass Activity:
- Principal (John):       12 bypasses
- Admissions (Mary):      10 bypasses
- Admin (Tom):             6 bypasses
```

**Insights:**
- Bypass feature is used sparingly (7.35%)
- Principal uses it most (likely urgent cases)
- Could be used more for efficiency if needed

### **6. Source Performance**

Analysis of which inquiry sources convert best.

```
Source         Enquiries  Enrolled  Conversion
REFERRAL           52        28       53.85% ← Best!
WALK_IN            95        42       44.21%
PHONE              35        12       34.29%
WEBSITE            42         8       19.05% ← Needs work
AD_CAMPAIGN        21         2        9.52% ← Not working
```

**Insights:**
- Referral is most effective (invest more here)
- Website conversion is low (UX/messaging issue?)
- Ad campaigns might need rethinking

### **7. Monthly Trends**

Admission volume and conversion trends over time.

```
Month      Enquiries  Enrolled  Conversion
2025-09        32         8       25.0%
2025-10        45        18       40.0% ↑ (Good!)
2025-11        82        35       42.7% ↑ (Best!)
2025-12        86        28       32.6% ↓ (Holiday impact?)
2026-01        (...)
```

**Insights:**
- November was peak month
- December shows seasonal dip
- January recovery needed

---

## Service Methods

### **get_pipeline_funnel_stats(session)**

Get funnel data for a session:

```python
from admissions.workflow_service import AdmissionWorkflowService

funnel = AdmissionWorkflowService.get_pipeline_funnel_stats(session)
# Returns list of stages with counts and percentages
```

### **get_workflow_type_comparison(school)**

Compare all workflow types:

```python
comparison = AdmissionWorkflowService.get_workflow_type_comparison(school)
# Returns dict with SIMPLE, STANDARD, COMPLEX stats
```

### **get_stage_conversion_analysis(session)**

Get stage-to-stage conversion:

```python
analysis = AdmissionWorkflowService.get_stage_conversion_analysis(session)
# Returns list showing conversion between each stage
```

### **get_fee_analytics(school)**

Get fee collection stats:

```python
fees = AdmissionWorkflowService.get_fee_analytics(school)
# Returns fee collection metrics
```

### **get_bypass_analytics(school)**

Get bypass usage stats:

```python
bypass = AdmissionWorkflowService.get_bypass_analytics(school)
# Returns bypass usage patterns
```

### **get_source_performance(school)**

Get source-wise performance:

```python
sources = AdmissionWorkflowService.get_source_performance(school)
# Returns conversion rate by source
```

### **get_monthly_trends(school, months=6)**

Get monthly trends:

```python
trends = AdmissionWorkflowService.get_monthly_trends(school, months=6)
# Returns monthly admission stats
```

---

## Sample Dashboard Usage

### **Executive Dashboard**

```javascript
// Get overall school stats
GET /api/admissions/analytics/overall/

// Display:
- Key metrics: Total enquiries, enrollment %, revenue collected
- Workflow comparison chart (SIMPLE vs STANDARD vs COMPLEX)
- Monthly trends graph
- Top sources ranking
```

### **Session Manager Dashboard**

```javascript
// Get session-specific analytics
GET /api/admissions/analytics/session/:sessionId/

// Display:
- Pipeline funnel visualization (waterfall chart)
- Stage-to-stage conversion heatmap
- Bottleneck identification
- Time-to-enrollment distribution
```

### **Admissions Officer Dashboard**

```javascript
// Get fee and bypass analytics
GET /api/admissions/analytics/overall/

// Display:
- Pending fee collections list
- Recent bypass actions log
- Source performance (decide where to market)
- Follow-up priority queue
```

---

## Business Insights

### **Optimization Opportunities**

1. **Improve Form Submission Rate**
   - Stage: CONTACTED → FORM_SUBMITTED (76% conversion)
   - Action: Simplify form, send reminders, offer deadline extension

2. **Speed Up Approvals**
   - Stage: FORM_SUBMITTED → APPROVED (56% conversion, biggest drop)
   - Action: Add more approval staff, automate basic checks

3. **Boost Website Channel**
   - Source: WEBSITE (19% conversion vs 53% for referral)
   - Action: Better landing pages, clearer call-to-action, live chat

4. **Increase Referral Program**
   - Source: REFERRAL (53.85% highest conversion)
   - Action: Offer incentives, make referral process easier

### **Financial Metrics**

- **Fee Collection Rate**: 84.44% is good, target 90%+
- **Revenue per Admission**: Total fees ÷ Enrolled = Strategic pricing
- **Outstanding Fee Value**: Prioritize collection of highest amounts
- **Seasonal Trends**: Plan cash flow based on monthly patterns

---

## Implementation Example

### **Python Backend**

```python
from admissions.workflow_service import AdmissionWorkflowService
from admissions.models import AdmissionSession

session = AdmissionSession.objects.get(id=5)

# Get all analytics for dashboard
funnel = AdmissionWorkflowService.get_pipeline_funnel_stats(session)
conversion = AdmissionWorkflowService.get_stage_conversion_analysis(session)

# Display in API response
response = {
    'funnel': funnel,
    'conversion': conversion,
    'session': session.name,
}
```

### **Frontend (React Example)**

```jsx
import { LineChart, BarChart, PieChart } from 'recharts';

function AnalyticsDashboard() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch('/api/admissions/analytics/overall/')
      .then(r => r.json())
      .then(setData);
  }, []);

  if (!data) return <div>Loading...</div>;

  return (
    <div>
      {/* Overall stats */}
      <MetricCard 
        title="Conversion Rate" 
        value={data.overall.conversion_rate + '%'} 
      />

      {/* Workflow Comparison */}
      <BarChart>
        {Object.entries(data.workflow_type_comparison).map(([type, stats]) => (
          <Bar key={type} dataKey="conversion_rate" />
        ))}
      </BarChart>

      {/* Fee Analytics */}
      <PieChart data={data.fee_analytics.by_status} />

      {/* Monthly Trends */}
      <LineChart data={data.monthly_trends} />
    </div>
  );
}
```

---

## Future Enhancements

- [ ] Student success correlation (admission path → academic performance)
- [ ] Predictive analytics (which enquiries likely to convert)
- [ ] Custom date range filtering
- [ ] Export to Excel/PDF reports
- [ ] Automated alerts (e.g., "Conversion rate dropped 10%")
- [ ] A/B testing for different source channels
- [ ] Cost-per-enrollment by source
- [ ] ROI analysis for each marketing channel


"""Single source for which student statuses count as enrolled, departed or alumni.

Kept dependency-free so models, views, serializers, finance and insights can all
import it without cycles. Before this, "left" was defined separately in five places
and they disagreed (SUSPENDED counted as left in fee reports only).
"""

# Still on the roll.
ENROLLED_STATUSES = ('ACTIVE', 'REPEAT')
# Left the school: churn. Graduating is deliberately not here.
DEPARTED_STATUSES = ('WITHDRAWN', 'TRANSFERRED')
# Completed the highest class; shown as graduates once the next year exists.
ALUMNI_STATUSES = ('GRADUATED',)
# Anyone no longer on the roll, for reports that bill or total by who has gone.
NOT_ENROLLED_STATUSES = DEPARTED_STATUSES + ALUMNI_STATUSES

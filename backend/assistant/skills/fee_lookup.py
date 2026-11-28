"""Find the school's fee types (monthly and annual fee categories) from the words a user says.

Shared by the discount / scholarship tools (which fees a discount cuts), the optional-fee tools and fee
generation. Matching is by name, ignoring case and word order ("koder kids", "Kids Koder"); "all" means
every active fee.
"""
from ..registry import ProposalError
from . import lms_common as lc


def all_fee_types(school_id):
    """[(kind, category)] for every active monthly then annual fee category of the school."""
    from finance.models import AnnualFeeCategory, MonthlyFeeCategory

    return ([('MONTHLY', c) for c in MonthlyFeeCategory.objects.filter(school_id=school_id, is_active=True).order_by('name')]
            + [('ANNUAL', c) for c in AnnualFeeCategory.objects.filter(school_id=school_id, is_active=True).order_by('name')])


def _names(text):
    if isinstance(text, (list, tuple)):
        return [str(t).strip() for t in text if str(t).strip()]
    return [t.strip() for t in str(text or '').replace(' and ', ',').split(',') if t.strip()]


def resolve_fee_types(school_id, text, kind=None):
    """[(kind, category)] for comma-separated fee names, or "all". Raises ProposalError naming the fees
    available when one does not match or matches several. kind limits to 'MONTHLY' or 'ANNUAL'."""
    pool = [(k, c) for k, c in all_fee_types(school_id) if kind in (None, k)]
    names = _names(text)
    if not names:
        raise ProposalError('Which fees? Ask the user. Available: ' + (', '.join(c.name for _, c in pool) or 'none'))
    if len(names) == 1 and names[0].lower() in ('all', 'all fees', 'every fee'):
        return pool
    found = []
    for name in names:
        want = lc.tokens(name)
        hits = [(k, c) for k, c in pool if c.name.lower() == name.lower()] or \
               [(k, c) for k, c in pool if want and all(w in lc.tokens(c.name) for w in want)]
        if not hits:
            raise ProposalError(f'No fee called "{name}". Available: ' + (', '.join(c.name for _, c in pool) or 'none'))
        if len(hits) > 1:
            raise ProposalError(f'"{name}" matches several fees: ' + ', '.join(f'{c.name} ({k.lower()})' for k, c in hits) + '. Ask which.')
        if hits[0] not in found:
            found.append(hits[0])
    return found


def label(fee_types):
    return ', '.join(c.name for _, c in fee_types)

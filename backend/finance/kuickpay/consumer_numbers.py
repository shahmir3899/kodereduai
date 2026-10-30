"""Consumer-number generation: random, digit-only, permanently unique.

Layout: ``[biller prefix][random reference][check digits]``, stored as text so leading zeros survive.

Nothing here assumes Kuickpay's rules. The total length comes from the biller record and stays
unset until Kuickpay confirms it (assessment K-1), so no production number can be issued early. Only
the "no check digit" scheme exists; a check-digit algorithm is added only once Kuickpay names one (K-4).
Random rather than sequential so a bank-side inquiry cannot walk through children's records.

The database unique constraint on ``KuickpayBill.consumer_number`` is the final arbiter of uniqueness;
the pre-check below only keeps collisions (already negligible) from reaching it.
"""
import secrets
from dataclasses import dataclass

from finance.models import KuickpayBill

MIN_REFERENCE_DIGITS = 6
MAX_TOTAL_LENGTH = 19          # width of KuickpayBill.consumer_number
# scheme name -> number of check digits it appends. Extended only when Kuickpay confirms an algorithm.
CHECK_DIGIT_SCHEMES = {'NONE': 0}


class ConsumerNumberError(Exception):
    pass


class ConsumerNumberConfigError(ConsumerNumberError):
    """The biller is not configured well enough to issue numbers."""


class ConsumerNumberExhausted(ConsumerNumberError):
    """Not enough free numbers left for the requested count."""


@dataclass(frozen=True)
class NumberFormat:
    prefix: str
    total_length: int
    check_digits: int = 0

    @property
    def reference_digits(self):
        return self.total_length - len(self.prefix) - self.check_digits

    @property
    def capacity(self):
        return 10 ** self.reference_digits


def format_for_biller(biller):
    """The biller's number format, or ConsumerNumberConfigError when it cannot issue numbers yet."""
    if not biller.prefix or not biller.prefix.isdigit():
        raise ConsumerNumberConfigError('Biller prefix must be digits.')
    if biller.consumer_number_length is None:
        raise ConsumerNumberConfigError(
            'Consumer number length is not configured; it must be confirmed by Kuickpay first.'
        )
    if biller.check_digit_scheme not in CHECK_DIGIT_SCHEMES:
        raise ConsumerNumberConfigError(
            f'Check digit scheme {biller.check_digit_scheme!r} is not implemented.'
        )
    fmt = NumberFormat(
        prefix=biller.prefix,
        total_length=biller.consumer_number_length,
        check_digits=CHECK_DIGIT_SCHEMES[biller.check_digit_scheme],
    )
    if fmt.total_length > MAX_TOTAL_LENGTH:
        raise ConsumerNumberConfigError(f'Consumer number length cannot exceed {MAX_TOTAL_LENGTH}.')
    if fmt.reference_digits < MIN_REFERENCE_DIGITS:
        raise ConsumerNumberConfigError(
            f'Consumer number length leaves only {fmt.reference_digits} reference digits '
            f'(minimum {MIN_REFERENCE_DIGITS}).'
        )
    return fmt


def is_valid(number, fmt):
    """True when ``number`` has exactly this format's shape (digits, length, prefix)."""
    return (
        isinstance(number, str)
        and number.isascii()
        and number.isdigit()
        and len(number) == fmt.total_length
        and number.startswith(fmt.prefix)
    )


def generate_candidates(fmt, count, randbelow=secrets.randbelow):
    """``count`` distinct random numbers in this format (not yet checked against the database)."""
    found = set()
    while len(found) < count:
        reference = str(randbelow(fmt.capacity)).zfill(fmt.reference_digits)
        found.add(fmt.prefix + reference)
    return list(found)


def allocate(biller, count, *, randbelow=secrets.randbelow, max_rounds=10):
    """``count`` unused consumer numbers for ``biller``.

    Raises ConsumerNumberExhausted when the space is too crowded to find them, rather than looping.
    """
    if count <= 0:
        return []
    fmt = format_for_biller(biller)
    already = KuickpayBill.objects.filter(consumer_number__startswith=fmt.prefix).count()
    if already + count > fmt.capacity // 2:
        raise ConsumerNumberExhausted(
            f'Prefix {fmt.prefix} has {fmt.capacity} possible references and {already} are used; '
            f'refusing to issue {count} more above 50% occupancy.'
        )
    chosen = []
    for _ in range(max_rounds):
        need = count - len(chosen)
        candidates = generate_candidates(fmt, need + max(2, need // 10), randbelow=randbelow)
        taken = set(
            KuickpayBill.objects.filter(consumer_number__in=candidates).values_list('consumer_number', flat=True)
        )
        for number in candidates:
            if number not in taken and number not in chosen:
                chosen.append(number)
                if len(chosen) == count:
                    return chosen
    raise ConsumerNumberExhausted(f'Could not find {count} free consumer numbers for prefix {fmt.prefix}.')

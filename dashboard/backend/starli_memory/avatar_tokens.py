"""Strict canonical validation for Starli modular SVG bot avatar keys.

No SVG/HTML is accepted from callers; only compact allowlisted tokens are stored.
"""
import re

PRESETS=('atlas','agata','nova','kiro','mira','ledger','pixel')
SHELLS=('round','soft-square','hex','helmet','capsule','pixel')
FACES=('friendly','open','visor','focused','cute','minimal','pilot','screen')
EYES=('dots','round','pixel','sleepy','visor','spark')
MOUTHS=('smile','tiny','flat','open','none')
ACCESSORIES=('none','antenna','ears','headphones','crown','bolts','halo')
GRADIENTS=('diagonal','vertical','radial','horizontal')
BACKGROUNDS=('soft','ring','none')
PREFIX='custom:v1:'
HEX=re.compile(r'^[0-9a-fA-F]{6}$')

def canonical_avatar_key(value):
    """Return canonical bots.avatar marker or raise ValueError (fail closed)."""
    if not isinstance(value,str) or len(value)>175:
        raise ValueError('INVALID_AVATAR_KEY')
    name=value[7:] if value.startswith('preset:') else value
    if name in PRESETS:
        return 'preset:'+name
    if not value.startswith(PREFIX):
        raise ValueError('INVALID_AVATAR_KEY')
    fields=value[len(PREFIX):].split('.')
    if len(fields)!=9:
        raise ValueError('INVALID_AVATAR_PART_COUNT')
    shell,face,eyes,mouth,accessory,a,b,gradient,background=fields
    if (shell not in SHELLS or face not in FACES or eyes not in EYES
        or mouth not in MOUTHS or accessory not in ACCESSORIES or
        gradient not in GRADIENTS or background not in BACKGROUNDS
        or not HEX.fullmatch(a) or not HEX.fullmatch(b)):
        raise ValueError('INVALID_AVATAR_PART')
    return PREFIX+'.'.join([shell,face,eyes,mouth,accessory,a.lower(),b.lower(),gradient,background])

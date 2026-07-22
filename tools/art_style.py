#!/usr/bin/env python3
"""THE prompt/style layer. One file. Everything else imports it.

RATIFIED ART DIRECTION (user, 2026-07-13, from InvokeAI Community Edition):

    items    -> InvokeAI "Anime" template               <subject>, white background, bold outline
    units    -> InvokeAI "Anime" template               <subject>, portrait, looking at viewer, white background
    monsters -> InvokeAI "Concept Art (Fantasy)"        <subject>, white background
    fills    -> FILL_STYLE below (NOT a template -- see below)

This SUPERSEDES the Norse dark-fantasy painterly direction, including REQ-0127's
ratified (S7 ALL GREEN) unit roster style. Do not reintroduce it.

THE `++` SYNTAX IS INVOKEAI'S, NOT COMFYUI'S. InvokeAI weights with trailing
`+`/`-` (each `+` is x1.1, compounding). ComfyUI does not understand it: pasted
verbatim, the plus signs tokenise as text. `to_comfy()` converts to `(text:weight)`.

  Measured, do not skip it: weighted vs weights-stripped on the same seed are NOT
  the same image (mean abs diff 38.9 on the sword, 8.8 on the goblin), and the
  weighted leg is visibly better -- the sword fills its 1x3 cell footprint, the
  flattened one floats small in the frame.

  THE REGEX HAS A TRAP. A naive `(\\S+)(\\++|-+)` reads the hyphen in "cel-shaded
  coloring" as a DE-emphasis marker and emits "(cel:0.909)shaded coloring", and it
  leaves "anime++" as "(anime+:1.1)". The trailing-boundary lookahead below is what
  prevents both. It is invisible unless you print the prompt; it would have
  poisoned every anime-template asset. Do not "simplify" it.

FILLS DO NOT USE A TEMPLATE. The Anime template's "bold outline" + cel-shading turn
a fill brief into a discrete bordered OBJECT -- REQ-0150 generated a stitched
leather patch when it asked for a leather texture. A fill has to say, positively,
that it is a fill: allover, edge to edge, no focal object, no border, no outline.
"""
import re

TEMPLATES = {
    # invoke-ai/InvokeAI default_style_presets.json, verbatim.
    "anime": "{prompt} anime++, bold outline, cel-shaded coloring, shounen, seinen",
    "concept_art_fantasy": (
        "concept artwork of a {prompt}. (digital painterly art style)++, mythological, "
        "(textured 2d dry media brushpack)++, glazed brushstrokes, otherworldly. "
        "painting+, illustration+"),
}
# Their negative_prompts are recorded for provenance and NOT used: this route has
# no negative (art_route.build_txt2img refuses one).
TEMPLATE_NEGATIVES_UNUSED = {
    "anime": "(photo)+++. greyscale. solid black. painting",
    "concept_art_fantasy": "photo. distorted, blurry, out of focus. sketch. (cgi, 3d.)++",
}

KIND_TEMPLATE = {"item": "anime", "unit": "anime", "monster": "concept_art_fantasy", "vfx": "concept_art_fantasy"}  # REQ-0280/0264: hit-role fallback; ray uses FILL_STYLE (art_job). Fable refines.

# =============================================================================
# HOW TO WRITE A SUBJECT. Measured on the full REQ-0150 regeneration, where 5 of
# 8 items and 7 of 11 units missed on the SUBJECT while the STYLE was fine. Read
# this before writing a defs file; it is the difference between a batch and a
# wasted GPU hour.
#
# THE ANIME TEMPLATE DRIFTS MODERN. Its "shounen, seinen" tokens, handed a subject
# with no fantasy iconography of its own, produce a contemporary anime character:
#   "angel"           -> a blonde girl in a blazer and tie. No wings. No halo.
#   "berserker"       -> a young man in a tank top. No beard, no fur.
#   "hooded watcher"  -> a man in a modern HOODIE.
#   "young squire"    -> a boy in a school uniform.
#   "little princess" -> a schoolgirl (3 of 4).
# The units that LANDED on a plain name (elf, thief, shieldmaiden, priest) all
# carry fantasy iconography ABOVE THE SHOULDERS: pointed ears, a rogue's hood,
# plate pauldrons, a cowl. => A UNIT SUBJECT MUST STATE ITS IDENTITY IN
# FACE-AND-SHOULDER TERMS: wings, halo, crown, beard, helm, fur, cowl.
#
# The CONCEPT ART (FANTASY) template does NOT have this problem -- "mythological,
# digital painterly art style" carries the fantasy signal itself. Monsters came
# out right on bare plain names (goblin, ogre, wight, gnoll). The drift is an
# ANIME-template property, not a model property.
#
# ANY NOUN IMPLYING SOMETHING OUTSIDE THE HEAD DRAGS IT INTO FRAME and widens the
# shot out of a bust -- even with "portrait" present, which it was in every failing
# prompt. Three kinds, all observed:
#   KIT       "dagger", "belts and pouches", "leather armor" -> half-body
#   STATURE   "dwarf"                -> full body 2/4 (its defining trait is bodily)
#   RELATION  "light cavalry RIDER"  -> a HORSE, 4/4, full body
# Where the identity is bodily, "portrait" is not enough: add "bust, head and
# shoulders" explicitly.
#
# ITEM SUBJECTS: PART-OF nouns and compound nouns resolve to the wrong object.
#   "sword hilt"      -> a WHOLE SWORD (4/4). "hilt" is not renderable alone.
#   "longsword blade" -> a whole sword WITH a handle (4/4).
#   "beast jaw"       -> a whole monster HEAD (4/4).
#   "tower shield"    -> a STONE TOWER (4/4). Wrong head word of the compound.
# There is NO NEGATIVE PROMPT on this route to say what a thing is not, so the
# subject must say, positively, what it IS: "a detached sword blade only, a bare
# steel blade with no handle".
#
# The Art Golden's "plain, simple names" rule is still right -- it is about not
# dressing a subject in gorgeous prose. It is not a licence to hand the model a
# bare noun it will resolve to something else.
# =============================================================================

FILL_STYLE = ("seamless repeating allover texture fill, tileable pattern, flat even "
              "lighting, uniform density edge to edge, filling the entire frame, no "
              "focal object, no single object, no border, no frame, no outline, no "
              "vignette, no shadow, cel-shaded coloring, flat colors, anime game "
              "texture, high detail, sharp focus")

# body is either a (parenthesised group) or a run with no whitespace/comma/period/
# paren/plus; then a run of + or -; then a BOUNDARY. The lookahead is the load-
# bearing part -- see the module docstring.
_EMPH = re.compile(r"(\([^)]+\)|[^\s,.()+]+)([+-]+)(?=[\s,.]|$)")


def _unwrap(body):
    return body[1:-1] if body.startswith("(") and body.endswith(")") else body


def to_comfy(t):
    """InvokeAI emphasis -> ComfyUI (text:weight). `anime++` -> `(anime:1.21)`."""
    def sub(m):
        body, marks = _unwrap(m.group(1)), m.group(2)
        w = 1.1 ** len(marks) if marks[0] == "+" else 1.1 ** -len(marks)
        return "(%s:%s)" % (body, round(w, 3))
    return _EMPH.sub(sub, t)


def flatten(t):
    """Same template with the emphasis markers dropped. The control leg."""
    return _EMPH.sub(lambda m: _unwrap(m.group(1)), t)


def render(template, subject, weighted=True):
    t = TEMPLATES[template] if template in TEMPLATES else template
    t = to_comfy(t) if weighted else flatten(t)
    return t.replace("{prompt}", subject) if "{prompt}" in t else "%s %s" % (subject, t)


def for_kind(kind, subject, weighted=True):
    return render(KIND_TEMPLATE[kind], subject, weighted)


def edit_instruction(subject):
    """REQ-0183: turn a subject into the REQ-0153 shape-EDIT instruction.

    FLUX.2 klein unifies t2i and image editing in one architecture, so when a
    scaffold rides along as a ReferenceLatent the prompt must read as an
    instruction ABOUT that reference ("turn the gray shape into ..."), not as a
    plain subject. This is the wording REQ-0153 scored GREEN with.

    `subject` is the ALREADY-COMPOSED subject -- the artwork's prompt_template
    with {main_object} substituted -- i.e. exactly what the unconditioned path
    hands to for_kind(). The caller still wraps the result in the kind/override
    style template, so the only thing added here is the shape directive.

    DELIBERATE DEVIATION from the REQ-0153 addendum's sketch, which appended
    "white background, bold outline" itself: on the REQ-0151 admin path the PO
    prompt_template ALREADY owns that clause (its default is
    "{main_object}, white background, bold outline"), so re-stating it here
    would duplicate it in every prompt. Same tokens, stated once. The shape lock
    is mechanical (ReferenceLatent + SetLatentNoiseMask), not prompt-order
    dependent.
    """
    return "Turn the gray shape into %s. Keep the silhouette exactly." % subject


def fill_prompt(material_clause):
    """`material_clause` must end in ', ' -- e.g. "brown leather texture, worn grain, "."""
    return material_clause + FILL_STYLE


def gen_size(cells_w, cells_h, px_per_cell=256):
    """Generation size for a cell footprint. The ASPECT RATIO must match the
    footprint -- that is the change that made the user's icons fill their cells.
    Snapped to /16 (a latent cannot be 756 px tall, which is why the user's
    256x756 sword became 256x768).

    px_per_cell is a RESOLUTION knob, not a law: the user used 256 for items
    (few cells, need pixels to work with) and 128 for monsters and textures
    (many cells, already big enough). Both are fine. Only the ratio is binding.
    """
    r16 = lambda v: max(16, int(round(v / 16.0)) * 16)
    return r16(cells_w * px_per_cell), r16(cells_h * px_per_cell)

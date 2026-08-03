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

KIND_TEMPLATE = {"item": "anime", "unit": "anime", "monster": "concept_art_fantasy"}
# vfx is NOT in KIND_TEMPLATE: both roles use the dedicated VFX_*_STYLE grammars
# below (REQ-0280 P4 final ruling -- the P1 provisional fill/concept-art routing
# is superseded; see the VFX block after FILL_STYLE).

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



# =============================================================================
# VFX (REQ-0280 P4 -- FINAL art direction; rules the P1 PROVISIONAL wiring and
# REQ-0264 s12.3's open template question). Ray strips (256x64, forced-tiling
# in X) and hit bursts (256x256) are ENERGY assets consumed at game scale --
# a ray band draws ~10 px tall on the /schedule monitor -- composited over the
# night-iron field. Four rulings, each measured or argued in REQ-0280 P4
# evidence:
#   1. PURE BLACK ground, never white. The vfx matte is the border-key
#      (alpha from distance-to-black), so black IS the alpha channel; a white
#      ground fringes bright energy and reads as a sticker over the dark board.
#   2. NO bold cartoon outline. The Anime template is banned for vfx -- its
#      "bold outline" turns a beam into a bordered OBJECT (the measured
#      leather-patch failure, art_pipeline.md s3, same mechanism). Silhouette
#      must come from luminance falloff, not a stroke.
#   3. V2-as-amended (no-baked-glow, REQ-0264 s10): soft INNER luminance
#      gradients are the asset's essence -- a streak IS light -- and are
#      PERMITTED inside the silhouette. Wide OUTER halos/bloom fields are
#      FORBIDDEN: the client already spends the styleguide's glow budget
#      (additive head + impact ramp, <=3 sources) and a baked halo cannot be
#      culled. vfx.flatness polices the alpha skirt on the cutout.
#   4. NO text, runes, glyphs, sigils, lens flares. At 10 px they are noise;
#      at full size they are kitsch. MJOLNIR: energy without lettering.
# Element semantics ride in the SUBJECT clause (one dominant hue per asset,
# styleguide s2 "1yousou 1shoku"): defaults are element-NEUTRAL pale gold /
# bone-white so renderer tinting stays coherent; frost skills use the frost
# family, fire uses ember, traps ember-lo/blood.
# =============================================================================

VFX_RAY_STYLE = (
    "horizontal energy streak++, one single straight beam running edge to edge "
    "across the frame, centered vertically, thin bright core with soft luminance "
    "fading inside the streak, wisps and sparks stretched horizontally along the "
    "beam, (pure black background)++, seamless horizontal repeat, painterly "
    "concept art game vfx, strong simple silhouette, high detail, sharp focus, "
    "no outline, no border, no frame, no text, no runes, no glyphs, no lens flare")

VFX_HIT_STYLE = (
    "radial energy burst++, one single centered impact flash, jagged spikes and "
    "sparks radiating from a small bright core, soft luminance fading inside the "
    "burst, (pure black background)++, painterly concept art game vfx, strong "
    "simple silhouette readable when tiny, high detail, sharp focus, no outline, "
    "no border, no frame, no text, no runes, no glyphs, no lens flare")


def vfx_prompt(role, subject_clause):
    """REQ-0280 P4: the vfx prompt. `subject_clause` follows fill_prompt's
    contract -- '' or a clause ending in ', ' (e.g. "pale gold energy, ").
    The styles carry InvokeAI emphasis, so convert here (render() does the
    same for the template kinds)."""
    return subject_clause + to_comfy(VFX_RAY_STYLE if role == "ray" else VFX_HIT_STYLE)


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


# =============================================================================
# SKILL ICON (REQ-0292 P3 -- FINAL art direction; supersedes the P1 provisional
# KIND_TO_STYLE skill_icon->item routing). A skill_icon is a 256x256 EMBLEM the
# monitor's skill badge draws at ~18-22 px inside a circle over MJOLNIR panel
# ground -- an icon consumed twelve times smaller than it is generated. Five
# rulings, each inheriting a measured REQ-0280/REQ-0150 failure class:
#   1. EMBLEM, not illustration: ONE centered symbolic object filling most of
#      the frame. At 22 px a scene is mud; a silhouette survives. Thin
#      filigree, chain links, small floating debris die at that scale and are
#      banned from the grammar.
#   2. PURE BLACK ground, never white (vfx ruling 1, same mechanism): the
#      cutout runs the border-key matte, so black IS the alpha channel, and a
#      white ground fringes into a sticker over the night-iron board. Corollary
#      for icons: the SUBJECT must be brighter than the ground -- interior
#      luminance carries the shape, so bone/gold/ember/frost bodies, no
#      near-black subjects.
#   3. NO text, letters, runes, glyphs, sigil lettering. Styleguide s5: the 12
#      sanctioned Elder Futhark runes are UI VOCABULARY, single glyphs, audited
#      -- generated art must not counterfeit or collide with them (transcription
#      taboo), and at 22 px lettering is noise anyway. Zero glyph contamination.
#   4. NO bold cartoon outline (the Anime template stays banned, vfx ruling 2):
#      on a black ground the silhouette comes from massing + a bright rim
#      light, not a stroke that turns the emblem into a bordered object.
#   5. NO baked outer glow (V2-as-amended, REQ-0280 P4): rim light and inner
#      luminance are the icon's material; wide halo lobes duplicate the
#      client's glow budget and read as blur once downscaled to 22 px.
# Element semantics ride in the SUBJECT clause (one dominant hue per icon,
# styleguide s2 "1yousou 1shoku"), night-iron compatible: frost skills the
# frost family, fire ember, bleed/drain blood-tinged, holy/curse dull gold,
# neutral steel-and-bone. The subject stays a plain concrete object (whole
# object, never a PART-OF noun -- the "sword hilt" trap).
# =============================================================================

SKILL_ICON_STYLE = (
    "bold game skill icon++, one single centered emblem, massive simple "
    "silhouette readable when tiny, thick heavy shapes, painterly shading with "
    "a bright rim light, (pure black background)++, high contrast, high "
    "detail, sharp focus, no text, no letters, no runes, no glyphs, no "
    "watermark, no border, no frame, no thin filigree, no outer glow, "
    "no lens flare")


def skill_icon_prompt(subject_clause):
    """REQ-0292 P3: the skill_icon prompt. `subject_clause` follows
    fill_prompt's contract -- '' or a clause ending in ', ' (e.g.
    "a colossal ice-crusted bearded axe, pale frost blue, "). The style
    carries InvokeAI emphasis, so convert here (same as vfx_prompt)."""
    return subject_clause + to_comfy(SKILL_ICON_STYLE)

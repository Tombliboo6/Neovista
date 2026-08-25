from __future__ import annotations

from typing import Any, Dict, Mapping, Optional, Tuple


PROMPT_STRUCTURE_KEYS = (
    "p0_text",
    "p1_user",
    "p1_content",
    "p2_lighting",
    "p3_composition",
    "p4_rendering",
)

DEFAULT_PROMPT_FRAGMENTS = {
    "{user_input}",
    "{title}",
    "标题：{title}，数据标注：{data}，字体：无衬线黑体",
    "自然光照，柔和阴影",
    "标准构图",
    "高质量渲染",
}

DIAGRAM_NEGATIVE_PROMPT = (
    "neon lights, glowing effects, over-rendered, chaotic lines, "
    "cinematic lighting, messy, cyberpunk, dark background"
)


def _replace_parameters(value: str, parameters: Mapping[str, Any]) -> str:
    resolved = value
    for key, replacement in parameters.items():
        resolved = resolved.replace(f"{{{key}}}", "" if replacement is None else str(replacement))
    return resolved


def _resolve_prompt_structure(
    prompt_structure: Mapping[str, Any],
    parameters: Mapping[str, Any],
) -> Dict[str, Any]:
    return {
        key: _replace_parameters(value, parameters) if isinstance(value, str) else value
        for key, value in prompt_structure.items()
    }


def build_effective_template_prompt(
    template: Mapping[str, Any],
    *,
    user_params: Optional[str] = None,
    custom_prompt_structure: Optional[Mapping[str, Any]] = None,
    parameters: Optional[Mapping[str, Any]] = None,
) -> Tuple[str, Optional[Dict[str, Any]]]:
    """Build the same effective prompt used by generation and prompt preview."""
    normalized_user_params = (user_params or "").strip()
    normalized_parameters = {
        str(key): value
        for key, value in (parameters or {}).items()
        if str(key).strip()
    }
    template_structure = template.get("prompt_structure")
    source_structure = (
        custom_prompt_structure
        if isinstance(custom_prompt_structure, Mapping) and custom_prompt_structure
        else template_structure
    )
    use_structure = bool(
        normalized_user_params
        or custom_prompt_structure
        or normalized_parameters
        or not str(template.get("real_prompt") or "").strip()
    )

    if not use_structure:
        return str(template.get("real_prompt") or "").strip(), None

    if not isinstance(source_structure, Mapping):
        source_structure = {}
    resolved_structure = _resolve_prompt_structure(source_structure, normalized_parameters)

    prompt_parts = []
    for key in PROMPT_STRUCTURE_KEYS:
        value = resolved_structure.get(key)
        if not isinstance(value, str):
            continue
        normalized_value = value.strip()
        if normalized_value and normalized_value not in DEFAULT_PROMPT_FRAGMENTS:
            prompt_parts.append(normalized_value)

    base_prompt = "\n\n".join(prompt_parts).strip()
    if not base_prompt:
        base_prompt = _replace_parameters(
            str(template.get("real_prompt") or "").strip(),
            normalized_parameters,
        )

    if normalized_user_params:
        return f"{base_prompt}\n\n用户补充: {normalized_user_params}".strip(), resolved_structure
    return base_prompt, resolved_structure


def build_effective_diagram_prompt(
    template: Mapping[str, Any],
    *,
    parameters: Optional[Mapping[str, Any]] = None,
) -> str:
    normalized_parameters = {
        str(key): value
        for key, value in (parameters or {}).items()
        if str(key).strip()
    }
    base_prompt = str(template.get("real_prompt") or "").strip()
    if not base_prompt:
        structure = template.get("prompt_structure")
        if isinstance(structure, Mapping):
            base_prompt = "\n\n".join(
                str(structure.get(key) or "").strip()
                for key in PROMPT_STRUCTURE_KEYS
                if str(structure.get(key) or "").strip()
            )
    resolved_prompt = _replace_parameters(base_prompt, normalized_parameters)
    return f"{resolved_prompt}\n\n负面提示词: {DIAGRAM_NEGATIVE_PROMPT}".strip()

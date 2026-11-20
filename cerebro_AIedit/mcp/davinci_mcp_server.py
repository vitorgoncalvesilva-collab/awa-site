#!/usr/bin/env python3
"""
Servidor MCP Unificado — Cérebro AI Edit + samuelgursky/davinci-resolve-mcp (v5.0.3).
Roda diretamente no interpretador oficial ResolvePython (Python 3.14 embutido no DaVinci Resolve Studio 21.1)
sem precisar de pacotes externos (zero-dependency):
- 9 Ferramentas exclusivas do fluxo Cérebro AI Edit (BMPCC 4K, Bins padrão, Cores por Câmera, Auto-Caption PT-BR)
- 37 Compound Tools do samuelgursky/davinci-resolve-mcp (cobrindo 100% dos 336 métodos da API + Edit Engine,
  Frame Inspection em PNG, Color Grading Nodes, LUTs, DCTLs, Fusion, Fairlight, Media Analysis e Render)
- 9 MCP Resources + 14 MCP Prompts integrados.
"""

import base64
import inspect
import json
import os
import sys
import traceback
import types

# 1. Protege o stdout do protocolo MCP contra logs nativos em C++/Python (redireciona fd 1 -> stderr)
_rpc_fd = os.dup(1)
os.dup2(2, 1)
_rpc_out = os.fdopen(_rpc_fd, "w", buffering=1, encoding="utf-8")

# 2. Configura caminhos para o DaVinciResolveScript e para o vendor/davinci-resolve-mcp
WORKSPACE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VENDOR_MCP_DIR = os.path.join(WORKSPACE_DIR, "vendor", "davinci-resolve-mcp")
VENDOR_SRC_DIR = os.path.join(VENDOR_MCP_DIR, "src")

for p in (VENDOR_SRC_DIR, VENDOR_MCP_DIR):
    if os.path.isdir(p) and p not in sys.path:
        sys.path.insert(0, p)

try:
    import DaVinciResolveScript as dvr_script
except ImportError:
    sys.path.append("/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/Modules/")
    import DaVinciResolveScript as dvr_script


# ============================================================================
# Bridge Nativa FastMCP -> Protocolo MCP JSON-RPC 2.0 (Zero-Dependency)
# ============================================================================

VENDOR_TOOLS = []
VENDOR_RESOURCES = {}
VENDOR_PROMPTS = {}


class BridgeImage:
    """Representa uma imagem binária retornada por tools como timeline_frame."""
    def __init__(self, data: bytes = b"", format: str = "png", path: str | None = None):
        if path and not data:
            with open(path, "rb") as f:
                data = f.read()
        self.data = data
        self.format = format or "png"


class BridgeContext:
    """Contexto MCP mínimo para tools que aceitam ctx opcional."""
    def info(self, msg: str):
        sys.stderr.write(f"[MCP ctx.info] {msg}\n")

    def warning(self, msg: str):
        sys.stderr.write(f"[MCP ctx.warning] {msg}\n")

    def error(self, msg: str):
        sys.stderr.write(f"[MCP ctx.error] {msg}\n")


class BridgeFastMCP:
    """Substituto nativo do FastMCP que captura @mcp.tool, @mcp.resource e @mcp.prompt."""
    def __init__(self, name: str = "davinci-resolve", **kwargs):
        self.name = name
        self._mcp_server = types.SimpleNamespace(version="5.0.3")
        self._tool_manager = types.SimpleNamespace(_tools={})

    def tool(self, *args, **kwargs):
        def decorate(func):
            name = kwargs.get("name") or func.__name__
            doc = (inspect.getdoc(func) or f"Executa a ferramenta {name} no DaVinci Resolve.").strip()
            sig = inspect.signature(func)
            props = {}
            required = []

            for param_name, param in sig.parameters.items():
                if param_name == "ctx":
                    continue
                if param_name == "action":
                    props["action"] = {
                        "type": "string",
                        "description": "Ação a executar (use 'schema' para listar todas as ações e parâmetros suportados).",
                    }
                elif param_name == "params":
                    props["params"] = {
                        "type": "object",
                        "description": "Dicionário opcional com os parâmetros específicos da ação escolhida.",
                    }
                else:
                    props[param_name] = {"type": "string", "description": f"Parâmetro {param_name}"}

                if param.default is inspect.Parameter.empty:
                    required.append(param_name)

            schema = {"type": "object", "properties": props}
            if required:
                schema["required"] = required

            VENDOR_TOOLS.append({
                "name": name,
                "description": doc,
                "inputSchema": schema,
                "handler": lambda tool_args, _fn=func, _sig=sig: _invoke_vendor_tool(_fn, _sig, tool_args),
            })
            return func
        return decorate

    def resource(self, uri: str, *args, **kwargs):
        def decorate(func):
            VENDOR_RESOURCES[uri] = {
                "uri": uri,
                "name": kwargs.get("name") or func.__name__.lstrip("_"),
                "description": (inspect.getdoc(func) or "").strip(),
                "mimeType": "application/json",
                "handler": func,
            }
            return func
        return decorate

    def prompt(self, *args, **kwargs):
        def decorate(func):
            name = kwargs.get("name") or func.__name__
            VENDOR_PROMPTS[name] = {
                "name": name,
                "description": kwargs.get("description") or (inspect.getdoc(func) or "").strip(),
                "handler": func,
            }
            return func
        return decorate


def _invoke_vendor_tool(fn, sig, tool_args: dict):
    call_kwargs = {}
    for pname, param in sig.parameters.items():
        if pname == "ctx":
            call_kwargs["ctx"] = BridgeContext()
        elif pname in tool_args:
            call_kwargs[pname] = tool_args[pname]
        elif param.default is inspect.Parameter.empty and pname == "action":
            call_kwargs["action"] = tool_args.get("action", "schema")
    return fn(**call_kwargs)


def _install_bridge_modules():
    """Registra os módulos mcp.* em sys.modules para carregar src.server no ResolvePython."""
    class ToolAnnotations:
        def __init__(self, *args, **kwargs):
            pass

    def stdio_server(*args, **kwargs):
        raise RuntimeError("Usando loop JSON-RPC nativo do Cérebro AI Edit")

    anyio = types.ModuleType("anyio")
    anyio.run = lambda func: func()

    mcp_mod = types.ModuleType("mcp")
    server_mod = types.ModuleType("mcp.server")
    fastmcp_mod = types.ModuleType("mcp.server.fastmcp")
    stdio_mod = types.ModuleType("mcp.server.stdio")
    mcp_types_mod = types.ModuleType("mcp.types")

    fastmcp_mod.FastMCP = BridgeFastMCP
    fastmcp_mod.Context = BridgeContext
    fastmcp_mod.Image = BridgeImage
    stdio_mod.stdio_server = stdio_server
    mcp_types_mod.ToolAnnotations = ToolAnnotations
    mcp_types_mod.ImageContent = object
    mcp_types_mod.TextContent = object
    mcp_types_mod.CallToolResult = object
    mcp_mod.types = mcp_types_mod

    for mod_name, mod_obj in {
        "anyio": anyio,
        "mcp": mcp_mod,
        "mcp.server": server_mod,
        "mcp.server.fastmcp": fastmcp_mod,
        "mcp.server.stdio": stdio_mod,
        "mcp.types": mcp_types_mod,
    }.items():
        sys.modules[mod_name] = mod_obj


_install_bridge_modules()

# Carrega as 37 compound tools, 9 resources e 14 prompts do samuelgursky/davinci-resolve-mcp
try:
    if os.path.isdir(VENDOR_MCP_DIR):
        import src.server as _vendor_server
        _vendor_server._apply_persisted_envelope_mode()
except Exception as _vendor_exc:
    sys.stderr.write(f"[Aviso] Falha ao carregar vendor/davinci-resolve-mcp: {_vendor_exc}\n")


# ============================================================================
# Ferramentas Exclusivas Cérebro AI Edit (BMPCC 4K + Fluxo Personalizado)
# ============================================================================

BINS_PADRAO = [
    "00_seqs",
    "01_raw",
]

BINS_SOB_DEMANDA = [
    "02_assets",
    "03_trilha",
    "04_sfx",
]


def get_resolve():
    resolve = dvr_script.scriptapp("Resolve")
    if not resolve:
        raise RuntimeError(
            "Não foi possível conectar ao DaVinci Resolve Studio. "
            "Verifique se o aplicativo está aberto e com 'External scripting using: Local' ativo."
        )
    return resolve


def get_project_and_pool():
    resolve = get_resolve()
    pm = resolve.GetProjectManager()
    project = pm.GetCurrentProject() if pm else None
    if not project:
        raise RuntimeError("Nenhum projeto está aberto no DaVinci Resolve Studio no momento.")
    media_pool = project.GetMediaPool()
    return resolve, project, media_pool


def find_or_create_bin(media_pool, parent_folder, name, create_if_missing=True):
    for sub in (parent_folder.GetSubFolderList() or []):
        if sub.GetName() == name:
            return sub, False
    if create_if_missing:
        new_folder = media_pool.AddSubFolder(parent_folder, name)
        return new_folder, True
    return None, False


def find_bin_recursive(folder, name):
    if folder.GetName() == name:
        return folder
    for sub in (folder.GetSubFolderList() or []):
        found = find_bin_recursive(sub, name)
        if found:
            return found
    return None


def collect_all_clips(folder, path_prefix=""):
    current_path = f"{path_prefix}/{folder.GetName()}" if path_prefix else folder.GetName()
    results = []
    for clip in (folder.GetClipList() or []):
        results.append((clip, folder, current_path))
    for sub in (folder.GetSubFolderList() or []):
        results.extend(collect_all_clips(sub, current_path))
    return results


def inspect_folder_tree(folder):
    clips = folder.GetClipList() or []
    clip_list = []
    for clip in clips:
        props = clip.GetClipProperty() or {}
        meta = clip.GetMetadata() or {}
        clip_list.append({
            "name": clip.GetName(),
            "type": props.get("Type", ""),
            "fps": props.get("FPS", ""),
            "resolution": props.get("Resolution", ""),
            "duration": props.get("Duration", ""),
            "codec": props.get("Video Codec", ""),
            "camera_type": meta.get("Camera Type", "") or props.get("Camera Type", ""),
            "clip_color": clip.GetClipColor() or "None",
            "markers_count": len(clip.GetMarkers() or {}),
        })
    return {
        "name": folder.GetName(),
        "clip_count": len(clips),
        "clips": clip_list,
        "subfolders": [inspect_folder_tree(sub) for sub in (folder.GetSubFolderList() or [])],
    }


def classify_clip(clip, parent_folder_name="", folder_path=""):
    props = clip.GetClipProperty() or {}
    meta = clip.GetMetadata() or {}
    name_lower = (clip.GetName() or "").lower()
    folder_lower = (parent_folder_name or "").lower()
    path_lower = (folder_path or "").lower()
    clip_type = (props.get("Type", "") or "").lower()
    codec = (props.get("Video Codec", "") or "").lower()
    camera = (meta.get("Camera Type", "") or props.get("Camera Type", "") or "").lower()
    file_path = (props.get("File Path", "") or "").lower()

    if clip_type == "timeline":
        return None, "00_seqs", "Timeline / Sequência (00_seqs)"

    # 1. Assets: PNGs, Stills, Motions (LT_H_*, LT_V_*), After Effects, Vinhetas, Logos -> 02_assets
    is_asset = (
        "still" in clip_type
        or "generator" in clip_type
        or file_path.endswith((".png", ".jpg", ".jpeg", ".psd", ".svg", ".gif", ".tiff", ".webp"))
        or name_lower.endswith((".png", ".jpg", ".jpeg", ".psd", ".svg", ".gif", ".tiff", ".webp"))
        or "/after/" in file_path
        or "\\after\\" in file_path
        or "/00_assets/" in file_path
        or "/assets/" in file_path
        or "/inserts" in file_path
        or folder_lower in ("02_assets", "assets", "00_assets", "after", "03_after", "inserts", "04_inserts")
        or name_lower.startswith(("lt_", "00_isb_vinheta", "vinheta", "logo_", "gc_", "loop_"))
        or "animation" in codec
        or "prores 4444" in codec
    )
    if is_asset:
        return "Teal", "02_assets", "Asset / PNG / Motion (02_assets)"

    # 2. Câmeras Principais e Secundárias -> 01_raw
    is_olympus = (
        "olympus" in camera
        or "e-m1" in camera
        or "olymp_" in file_path
        or "olymp_" in name_lower
        or "olymp_" in folder_lower
        or "olymp_" in path_lower
        or name_lower.startswith("gonc")
    )
    if is_olympus:
        speech_tag = " [Cartão com Entrevista]" if "speech" in folder_lower or "speech" in path_lower else ""
        return "Navy", "01_raw", f"Olympus OM-D E-M1 Mark II (Navy){speech_tag}"

    is_bmpcc6k = (
        "bmpcc6k" in file_path
        or "bmpcc6k" in folder_lower
        or "bmpcc6k" in path_lower
        or "bmpcc 6k" in camera
        or "pocket 6k" in camera
    )
    if is_bmpcc6k:
        return "Pink", "01_raw", "Blackmagic Pocket Cinema Camera 6K (Pink)"

    is_bmpcc = (
        "blackmagic" in camera
        or "pocket" in camera
        or "bmpcc" in camera
        or "braw" in codec
        or "blackmagic raw" in codec
        or file_path.endswith(".braw")
        or "bmpcc" in name_lower
        or "bmpcc" in file_path
        or "bmppc" in file_path
        or "bmpcc" in folder_lower
        or "bmpcc" in path_lower
        or name_lower.startswith("a0")
    )
    if is_bmpcc:
        return "Purple", "01_raw", "Blackmagic Pocket Cinema Camera 4K (Purple)"

    is_panasonic_s9 = (
        "s9_" in file_path
        or "s9_" in folder_lower
        or "s9_" in path_lower
        or "lumix s9" in camera
        or "dc-s9" in camera
        or (name_lower.startswith("p10") and name_lower.endswith(".mov"))
    )
    if is_panasonic_s9:
        return "Olive", "01_raw", "Panasonic Lumix S9 (Olive)"

    is_sony_a6400 = (
        "a6400" in file_path
        or "a6400" in folder_lower
        or "a6400" in path_lower
        or "ilce-6400" in camera
    )
    if is_sony_a6400:
        return "Lime", "01_raw", "Sony Alpha a6400 (Lime)"

    is_drone_mavic = (
        "mavic" in file_path
        or "mavic" in folder_lower
        or "mavic" in path_lower
        or "mavicm4" in file_path
        or "mavicm4" in folder_lower
        or "mavicm4" in path_lower
        or "dji_" in name_lower
    )
    if is_drone_mavic:
        return "Blue", "01_raw", "Drone DJI Mavic / Aérea (Blue)"

    is_secondary_cam = (
        any(tag in file_path or tag in folder_lower or tag in name_lower for tag in ("a7s", "gopro", "gx80", "fx3", "fx30", "zv-e"))
        or any(brand in camera for brand in ("sony", "panasonic", "canon", "fujifilm", "gopro", "dji"))
        or "/raw/" in file_path
        or "\\raw\\" in file_path
        or "/01_raw" in path_lower
    )
    if is_secondary_cam and "video" in clip_type:
        return "Blue", "01_raw", "Câmera Secundária / Extra (Blue)"

    # 3. Áudio: 04_sfx vs 03_trilha
    is_audio_only = ("audio" in clip_type and "video" not in clip_type) or file_path.endswith((".wav", ".mp3", ".aiff", ".flac", ".m4a", ".ogg"))
    if is_audio_only:
        is_sfx = (
            "/sfx/" in file_path
            or "\\sfx\\" in file_path
            or folder_lower in ("04_sfx", "sfx")
            or any(
                kw in name_lower
                for kw in ("sfx", "fx_", "_fx", "whoosh", "swoosh", "riser", "hit_", "_hit", "impact", "foley", "ambience", "ambiencia", "beep", "glitch", "click", "transition")
            )
        )
        if is_sfx:
            return "Green", "04_sfx", "Efeito Sonoro / SFX (04_sfx)"

        is_voice_or_external_rec = any(
            kw in name_lower or kw in file_path or kw in folder_lower
            for kw in ("locucao", "locução", "voz", "voice", "lapela", "gravador", "zoom_", "tascam")
        )
        if not is_voice_or_external_rec:
            return "Green", "03_trilha", "Trilha Sonora / Música (03_trilha)"

    return None, None, "Não identificado (mantido intocado)"


def tool_resolve_get_status(args):
    resolve = get_resolve()
    pm = resolve.GetProjectManager()
    project = pm.GetCurrentProject() if pm else None

    result = {
        "connected": True,
        "product": resolve.GetProductName(),
        "version": resolve.GetVersionString(),
        "is_studio": resolve.IsStudio(),
        "current_page": resolve.GetCurrentPage(),
        "database": pm.GetCurrentDatabase() if pm else None,
        "project": None,
    }

    if project:
        mp = project.GetMediaPool()
        root = mp.GetRootFolder() if mp else None
        cur_tl = project.GetCurrentTimeline()
        tl_count = project.GetTimelineCount()

        timelines = []
        for idx in range(1, tl_count + 1):
            tl = project.GetTimelineByIndex(idx)
            if tl:
                markers = tl.GetMarkers() or {}
                timelines.append({
                    "index": idx,
                    "name": tl.GetName(),
                    "start_timecode": tl.GetStartTimecode(),
                    "start_frame": tl.GetStartFrame(),
                    "end_frame": tl.GetEndFrame(),
                    "video_tracks": tl.GetTrackCount("video"),
                    "audio_tracks": tl.GetTrackCount("audio"),
                    "subtitle_tracks": tl.GetTrackCount("subtitle"),
                    "markers": markers,
                })

        result["project"] = {
            "name": project.GetName(),
            "fps": project.GetSetting("timelineFrameRate"),
            "resolution": f"{project.GetSetting('timelineResolutionWidth')}x{project.GetSetting('timelineResolutionHeight')}",
            "current_timeline": cur_tl.GetName() if cur_tl else None,
            "timeline_count": tl_count,
            "timelines": timelines,
            "media_pool": inspect_folder_tree(root) if root else None,
        }

    return result


def tool_resolve_open_page(args):
    resolve = get_resolve()
    page = args.get("page", "edit").lower()
    valid_pages = ["media", "cut", "edit", "fusion", "color", "fairlight", "deliver"]
    if page not in valid_pages:
        raise ValueError(f"Página inválida '{page}'. Opções válidas: {valid_pages}")
    ok = resolve.OpenPage(page)
    return {"success": bool(ok), "current_page": resolve.GetCurrentPage()}


def tool_resolve_setup_bins(args):
    _, _, media_pool = get_project_and_pool()
    root = media_pool.GetRootFolder()
    custom_bins = args.get("bin_names") or BINS_PADRAO
    raw_cards = list(args.get("raw_cards") or [])
    project_folder = args.get("project_folder")

    if project_folder and os.path.isdir(project_folder):
        for candidate_raw in ("raw", "RAW"):
            raw_disk_dir = os.path.join(project_folder, candidate_raw)
            if os.path.isdir(raw_disk_dir):
                for entry in sorted(os.listdir(raw_disk_dir)):
                    full_entry = os.path.join(raw_disk_dir, entry)
                    if os.path.isdir(full_entry) and not entry.startswith(".") and entry not in raw_cards:
                        raw_cards.append(entry)

    report = {}
    raw_bin_obj = None
    for bname in custom_bins:
        folder_obj, created = find_or_create_bin(media_pool, root, bname, create_if_missing=True)
        report[bname] = "criado" if created else "já existia"
        if bname.lower() in ("01_raw", "raw") or bname.lower().endswith("_raw"):
            raw_bin_obj = folder_obj

    raw_cards_report = {}
    if raw_cards:
        if not raw_bin_obj:
            raw_bin_obj, _ = find_or_create_bin(media_pool, root, "01_raw", create_if_missing=True)
        raw_bin_label = raw_bin_obj.GetName()
        for card_name in raw_cards:
            _, card_created = find_or_create_bin(media_pool, raw_bin_obj, card_name, create_if_missing=True)
            raw_cards_report[f"{raw_bin_label}/{card_name}"] = "criado" if card_created else "já existia"

    return {"success": True, "bins": report, "raw_cards": raw_cards_report}


def resolve_nested_bin(media_pool, root, target_bin_path, create_if_missing=True):
    parts = [p for p in (target_bin_path or "").strip("/").split("/") if p and p != "Master"]
    if not parts:
        return root
    if len(parts) == 1:
        found = find_bin_recursive(root, parts[0])
        if found:
            return found
        folder_obj, _ = find_or_create_bin(media_pool, root, parts[0], create_if_missing=create_if_missing)
        return folder_obj or root
    curr = root
    for part in parts:
        curr, _ = find_or_create_bin(media_pool, curr, part, create_if_missing=create_if_missing)
        if not curr:
            return root
    return curr


def tool_resolve_import_media(args):
    _, _, media_pool = get_project_and_pool()
    root = media_pool.GetRootFolder()
    paths = args.get("file_paths") or []
    target_bin_name = args.get("target_bin")

    if not paths:
        raise ValueError("Informe ao menos um caminho em 'file_paths'.")

    target_folder = resolve_nested_bin(media_pool, root, target_bin_name, create_if_missing=True) if target_bin_name else root

    media_pool.SetCurrentFolder(target_folder)
    imported = media_pool.ImportMedia(paths) or []

    # REGRA: Se houver clipe em .mov/motion com Alpha mode em Premultiplied, aplicar Straight para não alterar a cor do vídeo
    fixed_alpha = []
    for clip in imported:
        props = clip.GetClipProperty() or {}
        alpha_mode = props.get("Alpha mode", "")
        name = clip.GetName() or ""
        if alpha_mode.lower() == "premultiplied" or (name.lower().endswith(".mov") and alpha_mode.lower() in ("premultiplied", "")):
            try:
                if clip.SetClipProperty("Alpha mode", "Straight"):
                    fixed_alpha.append(name)
            except Exception:
                pass

    return {
        "success": len(imported) > 0,
        "target_bin": target_folder.GetName(),
        "imported_count": len(imported),
        "imported_clips": [c.GetName() for c in imported],
        "straight_alpha_applied": fixed_alpha,
    }


def _is_inside_target_bin(folder_path: str, target_bin: str) -> bool:
    parts = [p.lower() for p in (folder_path or "").strip("/").split("/") if p]
    return target_bin.lower() in parts


def tool_resolve_organize_and_color_clips(args):
    _, _, media_pool = get_project_and_pool()
    root = media_pool.GetRootFolder()
    raw_move = args.get("move_to_bins", False)
    move_to_bins = raw_move if isinstance(raw_move, bool) else str(raw_move).lower() in ("true", "1", "yes")

    bin_map = {}
    created_bins = []
    if move_to_bins:
        for bname in BINS_PADRAO:
            folder_obj, was_created = find_or_create_bin(media_pool, root, bname, create_if_missing=True)
            bin_map[bname] = folder_obj
            if was_created:
                created_bins.append(bname)

    all_clips = collect_all_clips(root)
    processed = []
    untouched = []

    for clip, current_folder, folder_path in all_clips:
        props = clip.GetClipProperty() or {}
        # REGRA: motions/assets com canal alfa Premultiplied -> converter para Straight
        if props.get("Alpha mode", "").lower() == "premultiplied":
            try:
                clip.SetClipProperty("Alpha mode", "Straight")
            except Exception:
                pass

        color, suggested_bin, category = classify_clip(clip, current_folder.GetName(), folder_path)
        if color:
            clip.SetClipColor(color)

        if not suggested_bin:
            untouched.append({
                "clip_name": clip.GetName(),
                "current_bin": folder_path,
                "reason": category,
            })
            continue

        moved = False
        # REGRA PERMANENTE: Arquivos de câmera (01_raw: Olympus, BMPCC 4K, Cam Extra) NUNCA mudam de pasta ao serem coloridos!
        # Só movemos quando move_to_bins=True E o alvo for uma das pastas organizacionais (00_seqs, 02_assets, 03_trilha, 04_sfx).
        if move_to_bins and suggested_bin in ("00_seqs", "02_assets", "03_trilha", "04_sfx"):
            if not _is_inside_target_bin(folder_path, suggested_bin):
                if suggested_bin not in bin_map:
                    folder_obj, was_created = find_or_create_bin(media_pool, root, suggested_bin, create_if_missing=True)
                    bin_map[suggested_bin] = folder_obj
                    if was_created:
                        created_bins.append(suggested_bin)
                dest_folder = bin_map[suggested_bin]
                if current_folder != dest_folder:
                    moved = bool(media_pool.MoveClips([clip], dest_folder))

        processed.append({
            "clip_name": clip.GetName(),
            "category": category,
            "assigned_color": color,
            "previous_bin": folder_path,
            "target_bin": folder_path if suggested_bin == "01_raw" or not move_to_bins else suggested_bin,
            "moved": moved,
        })

    return {
        "success": True,
        "created_bins": created_bins,
        "processed_count": len(processed),
        "untouched_count": len(untouched),
        "clips": processed,
        "untouched_clips": untouched,
    }


def tool_resolve_create_timeline(args):
    _, project, media_pool = get_project_and_pool()
    root = media_pool.GetRootFolder()
    timeline_name = args.get("name", "tl_01_MAIN")
    bin_name = args.get("bin_name", "00_seqs")
    append_all_from_bin = args.get("from_bin")

    tl_folder, _ = find_or_create_bin(media_pool, root, bin_name, create_if_missing=True)
    media_pool.SetCurrentFolder(tl_folder)

    for idx in range(1, project.GetTimelineCount() + 1):
        existing = project.GetTimelineByIndex(idx)
        if existing and existing.GetName() == timeline_name:
            project.SetCurrentTimeline(existing)
            return {
                "success": True,
                "created": False,
                "message": f"Timeline '{timeline_name}' já existia e foi ativada.",
                "timeline": timeline_name,
            }

    timeline = None
    if append_all_from_bin:
        source_bin = find_bin_recursive(root, append_all_from_bin)
        if source_bin:
            clips = source_bin.GetClipList() or []
            if clips:
                timeline = media_pool.CreateTimelineFromClips(timeline_name, clips)

    if not timeline:
        timeline = media_pool.CreateEmptyTimeline(timeline_name)

    if not timeline:
        raise RuntimeError(f"Não foi possível criar a timeline '{timeline_name}'.")

    project.SetCurrentTimeline(timeline)
    timeline.SetTrackName("video", 1, "V1_BMPCC4K_MAIN")
    timeline.SetTrackName("audio", 1, "A1_DIALOGO")

    return {
        "success": True,
        "created": True,
        "timeline": timeline.GetName(),
        "start_timecode": timeline.GetStartTimecode(),
    }


def tool_resolve_manage_markers(args):
    _, project, _ = get_project_and_pool()
    timeline = project.GetCurrentTimeline()
    if not timeline:
        raise RuntimeError("Nenhuma timeline ativa no momento.")

    action = args.get("action", "list")
    if action == "list":
        return {
            "timeline": timeline.GetName(),
            "markers": timeline.GetMarkers() or {},
        }
    elif action == "clear":
        color = args.get("color", "All")
        ok = timeline.DeleteMarkersByColor(color)
        return {"success": bool(ok), "cleared_color": color}
    elif action == "add":
        markers = args.get("markers") or []
        added = 0
        for m in markers:
            frame_id = int(m.get("frame", 0))
            color = m.get("color", "Green")
            name = m.get("name", "Nota IA")
            note = m.get("note", "")
            duration = int(m.get("duration", 1))
            custom_data = m.get("custom_data", "ai_edit")
            if timeline.AddMarker(frame_id, color, name, note, duration, custom_data):
                added += 1
        return {
            "success": True,
            "timeline": timeline.GetName(),
            "added_count": added,
            "markers": timeline.GetMarkers() or {},
        }
    else:
        raise ValueError(f"Ação desconhecida '{action}'. Use 'list', 'add' ou 'clear'.")


def tool_resolve_create_subtitles(args):
    resolve, project, _ = get_project_and_pool()
    timeline = project.GetCurrentTimeline()
    if not timeline:
        raise RuntimeError("Nenhuma timeline ativa para gerar legendas.")

    chars_per_line = int(args.get("chars_per_line", 42))
    gap = int(args.get("gap", 2))
    lang_arg = str(args.get("language", "auto")).lower()

    # REGRA: Idioma padrão em AUTO (Auto Detect), mas aceita forçar se necessário
    if lang_arg in ("pt", "pt-br", "portuguese"):
        lang_constant = resolve.AUTO_CAPTION_PORTUGUESE
    elif lang_arg in ("en", "english"):
        lang_constant = resolve.AUTO_CAPTION_ENGLISH
    elif lang_arg in ("es", "spanish"):
        lang_constant = resolve.AUTO_CAPTION_SPANISH
    else:
        lang_constant = getattr(resolve, "AUTO_CAPTION_AUTO", resolve.AUTO_CAPTION_PORTUGUESE)

    settings = {
        resolve.SUBTITLE_LANGUAGE: lang_constant,
        resolve.SUBTITLE_CAPTION_PRESET: resolve.AUTO_CAPTION_SUBTITLE_DEFAULT,
        resolve.SUBTITLE_CHARS_PER_LINE: chars_per_line,
        resolve.SUBTITLE_LINE_BREAK: resolve.AUTO_CAPTION_LINE_SINGLE,
        resolve.SUBTITLE_GAP: gap,
    }
    ok = timeline.CreateSubtitlesFromAudio(settings)
    return {
        "success": bool(ok),
        "timeline": timeline.GetName(),
        "language": "AUTO_CAPTION_AUTO" if lang_constant == getattr(resolve, "AUTO_CAPTION_AUTO", None) else lang_arg,
        "subtitle_tracks": timeline.GetTrackCount("subtitle"),
    }


def tool_resolve_append_to_timeline(args):
    _, project, media_pool = get_project_and_pool()
    root = media_pool.GetRootFolder()
    timeline = project.GetCurrentTimeline()
    if not timeline:
        raise RuntimeError("Nenhuma timeline ativa no momento.")

    clip_names = args.get("clip_names") or []
    start_frame = args.get("start_frame")
    end_frame = args.get("end_frame")

    all_clips = collect_all_clips(root)
    clip_lookup = {clip.GetName(): clip for clip, _, _ in all_clips}

    append_infos = []
    for cname in clip_names:
        if cname not in clip_lookup:
            continue
        info = {"mediaPoolItem": clip_lookup[cname]}
        if start_frame is not None and end_frame is not None:
            info["startFrame"] = float(start_frame)
            info["endFrame"] = float(end_frame)
        append_infos.append(info)

    if not append_infos:
        raise ValueError(f"Nenhum dos clipes informados foi encontrado no Media Pool: {clip_names}")

    items = media_pool.AppendToTimeline(append_infos) or []
    return {
        "success": len(items) > 0,
        "appended_count": len(items),
        "timeline": timeline.GetName(),
    }


CEREBRO_TOOLS = [
    {
        "name": "resolve_get_status",
        "description": "Inspeciona o estado completo do DaVinci Resolve Studio: versão, página aberta, projeto atual, resolução, FPS, árvore de Bins do Media Pool, clipes com metadados/cores e timelines com markers.",
        "inputSchema": {"type": "object", "properties": {}},
        "handler": tool_resolve_get_status,
    },
    {
        "name": "resolve_open_page",
        "description": "Muda a página ativa do DaVinci Resolve Studio (media, cut, edit, fusion, color, fairlight, deliver).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "page": {
                    "type": "string",
                    "enum": ["media", "cut", "edit", "fusion", "color", "fairlight", "deliver"],
                    "description": "Nome da página para abrir no DaVinci Resolve.",
                }
            },
            "required": ["page"],
        },
        "handler": tool_resolve_open_page,
    },
    {
        "name": "resolve_setup_bins",
        "description": "Cria a estrutura padrão numerada em minúsculas para novos projetos no Media Pool (00_seqs, 01_raw) e opcionalmente subpastas de cartões logados dentro de '01_raw' (ex: olymp_01_chegadaspeech, olymp_02_passagem, bmpcc4k_passagem).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "bin_names": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Lista opcional de nomes de Bins na raiz do Media Pool. Se omitido, usa ['00_seqs', '01_raw'].",
                },
                "raw_cards": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Lista opcional de subpastas de cartões logados para criar dentro do Bin '01_raw' (ex: ['olymp_01_chegadaspeech', 'olymp_02_passagem', 'bmpcc4k_passagem']).",
                },
                "project_folder": {
                    "type": "string",
                    "description": "Caminho opcional da pasta do projeto no disco (ex: '/Volumes/ISB_TRANS/36_PIMPA_02112026') para espelhar automaticamente as subpastas de cartões logados dentro de '01_raw'.",
                },
            },
        },
        "handler": tool_resolve_setup_bins,
    },
    {
        "name": "resolve_import_media",
        "description": "Importa arquivos ou pastas de mídia do disco para um Bin específico do Media Pool no DaVinci Resolve (suporta subpastas aninhadas como '01_raw/olymp_01_chegadaspeech').",
        "inputSchema": {
            "type": "object",
            "properties": {
                "file_paths": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Lista de caminhos absolutos de arquivos ou pastas para importar.",
                },
                "target_bin": {
                    "type": "string",
                    "description": "Nome ou caminho do Bin de destino (ex: '01_raw/olymp_01_chegadaspeech', '02_pgm', '03_after'). Se não existir, será criado.",
                },
            },
            "required": ["file_paths"],
        },
        "handler": tool_resolve_import_media,
    },
    {
        "name": "resolve_organize_and_color_clips",
        "description": "Aplica cores por câmera/tipo (Navy para Olympus, Purple para BMPCC 4K, Blue para Cam Extra, Teal para Assets, Green para Trilha/SFX) SEM NUNCA mover arquivos de câmera de pasta. Quando move_to_bins=True (ex: 'Organizar Media Pool'), organiza apenas 00_seqs, 02_assets, 03_trilha e 04_sfx mantendo arquivos de câmera e itens não identificados 100% intocados em suas pastas.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "move_to_bins": {
                    "type": "boolean",
                    "description": "Padrão: false (apenas colore os clipes sem mudar nenhum arquivo de lugar). Se true (usado em 'Organizar Media Pool'), cria/move apenas 00_seqs, 02_assets, 03_trilha e 04_sfx, nunca movendo arquivos de câmera de suas pastas.",
                }
            },
        },
        "handler": tool_resolve_organize_and_color_clips,
    },
    {
        "name": "resolve_color_clips",
        "description": "Apenas aplica cores automaticamente por câmera/tipo (Navy para Olympus, Purple para BMPCC 4K, Blue para Cam Extra, Teal para Assets, Green para Trilha/SFX) SEM NUNCA mudar nenhum arquivo de pasta.",
        "inputSchema": {
            "type": "object",
            "properties": {},
        },
        "handler": lambda args: tool_resolve_organize_and_color_clips({"move_to_bins": False}),
    },
    {
        "name": "resolve_create_timeline",
        "description": "Cria uma nova timeline no projeto atual dentro do Bin '00_seqs' (vazia ou a partir dos clipes de um Bin) e nomeia as tracks padrão.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Nome da timeline a ser criada."},
                "bin_name": {"type": "string", "description": "Bin onde salvar a timeline (padrão: '00_seqs')."},
                "from_bin": {"type": "string", "description": "Opcional: Nome de um Bin cujos clipes devem ser adicionados à nova timeline."},
            },
            "required": ["name"],
        },
        "handler": tool_resolve_create_timeline,
    },
    {
        "name": "resolve_append_to_timeline",
        "description": "Adiciona clipes do Media Pool ao final da timeline ativa (suporta recorte de subclipe com start_frame e end_frame para decupagem).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "clip_names": {"type": "array", "items": {"type": "string"}, "description": "Lista de nomes dos clipes no Media Pool."},
                "start_frame": {"type": "number", "description": "Frame inicial opcional (Mark In)."},
                "end_frame": {"type": "number", "description": "Frame final opcional (Mark Out)."},
            },
            "required": ["clip_names"],
        },
        "handler": tool_resolve_append_to_timeline,
    },
    {
        "name": "resolve_manage_markers",
        "description": "Lista, adiciona ou limpa Markers coloridos de revisão, feedback e decupagem na timeline ativa.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "action": {"type": "string", "enum": ["list", "add", "clear"], "description": "Ação: 'list', 'add' ou 'clear'."},
                "color": {"type": "string", "description": "Usado quando action='clear' ('Red', 'Green', 'Blue', 'Yellow', 'Purple', 'All')."},
                "markers": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "frame": {"type": "integer"},
                            "color": {"type": "string", "enum": ["Green", "Blue", "Yellow", "Red", "Purple", "Cyan", "Pink"]},
                            "name": {"type": "string"},
                            "note": {"type": "string"},
                            "duration": {"type": "integer"},
                        },
                        "required": ["frame", "color", "name"],
                    },
                },
            },
            "required": ["action"],
        },
        "handler": tool_resolve_manage_markers,
    },
    {
        "name": "resolve_create_subtitles",
        "description": "Gera legendas automáticas no DaVinci Resolve Studio a partir do áudio da timeline ativa, usando por padrão detecção automática de idioma (AUTO_CAPTION_AUTO).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "chars_per_line": {"type": "integer", "description": "Máximo de caracteres por linha (padrão: 42)."},
                "gap": {"type": "integer", "description": "Intervalo mínimo em frames entre legendas (padrão: 2)."},
                "language": {"type": "string", "description": "Idioma da legenda (padrão: 'auto' para detecção automática; ou 'pt-br', 'en', etc.)."},
            },
        },
        "handler": tool_resolve_create_subtitles,
    },
]

# Combina as 9 ferramentas Cérebro AI Edit + as 37 compound tools do samuelgursky/davinci-resolve-mcp (46 tools no total)
ALL_TOOLS = CEREBRO_TOOLS + VENDOR_TOOLS
TOOL_MAP = {t["name"]: t["handler"] for t in ALL_TOOLS}
# Mantém alias para compatibilidade caso alguma conversa chame pelo nome antigo
TOOL_MAP["resolve_organize_and_color_clips"] = tool_resolve_organize_and_color_clips


# ============================================================================
# Loop do Protocolo JSON-RPC 2.0 (MCP Stdio)
# ============================================================================

def send_rpc(msg):
    _rpc_out.write(json.dumps(msg, ensure_ascii=False) + "\n")
    _rpc_out.flush()


def _format_tool_output(output):
    """Formata a saída de qualquer tool (dict, str, BridgeImage) para o padrão MCP."""
    if isinstance(output, BridgeImage):
        return (
            [
                {
                    "type": "image",
                    "data": base64.b64encode(output.data).decode("ascii"),
                    "mimeType": f"image/{output.format}",
                }
            ],
            False,
        )

    is_err = isinstance(output, dict) and bool(output.get("error"))
    text = output if isinstance(output, str) else json.dumps(output, ensure_ascii=False, indent=2, default=str)
    return ([{"type": "text", "text": text}], is_err)


def handle_request(req):
    method = req.get("method", "")
    req_id = req.get("id")
    params = req.get("params") or {}

    if req_id is None:
        return

    if method == "initialize":
        client_version = params.get("protocolVersion", "2024-11-05")
        send_rpc({
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "protocolVersion": client_version,
                "capabilities": {
                    "tools": {"listChanged": False},
                    "resources": {"listChanged": False},
                    "prompts": {"listChanged": False},
                },
                "serverInfo": {
                    "name": "davinci-resolve-studio-mcp-unified",
                    "version": "5.0.3+cerebro1.0",
                },
            },
        })
    elif method == "ping":
        send_rpc({"jsonrpc": "2.0", "id": req_id, "result": {}})
    elif method == "tools/list":
        tool_defs = [
            {
                "name": t["name"],
                "description": t["description"],
                "inputSchema": t["inputSchema"],
            }
            for t in ALL_TOOLS
        ]
        send_rpc({
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {"tools": tool_defs},
        })
    elif method == "resources/list":
        res_defs = [
            {
                "uri": r["uri"],
                "name": r["name"],
                "description": r["description"],
                "mimeType": r["mimeType"],
            }
            for r in VENDOR_RESOURCES.values()
        ]
        send_rpc({"jsonrpc": "2.0", "id": req_id, "result": {"resources": res_defs}})
    elif method == "resources/read":
        uri = params.get("uri", "")
        res = VENDOR_RESOURCES.get(uri)
        if not res:
            send_rpc({
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32602, "message": f"Recurso não encontrado: {uri}"},
            })
            return
        try:
            data = res["handler"]()
            text = data if isinstance(data, str) else json.dumps(data, ensure_ascii=False, indent=2, default=str)
            send_rpc({
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "contents": [
                        {
                            "uri": uri,
                            "mimeType": res["mimeType"],
                            "text": text,
                        }
                    ]
                },
            })
        except Exception as exc:
            send_rpc({
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32603, "message": str(exc)},
            })
    elif method == "prompts/list":
        prompt_defs = [
            {
                "name": p["name"],
                "description": p["description"],
            }
            for p in VENDOR_PROMPTS.values()
        ]
        send_rpc({"jsonrpc": "2.0", "id": req_id, "result": {"prompts": prompt_defs}})
    elif method == "tools/call":
        tool_name = params.get("name")
        tool_args = params.get("arguments") or {}
        handler = TOOL_MAP.get(tool_name)
        if not handler:
            send_rpc({
                "jsonrpc": "2.0",
                "id": req_id,
                "error": {"code": -32601, "message": f"Ferramenta não encontrada: {tool_name}"},
            })
            return

        try:
            output = handler(tool_args)
            content_blocks, is_err = _format_tool_output(output)
            send_rpc({
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": content_blocks,
                    "isError": is_err,
                },
            })
        except Exception as exc:
            send_rpc({
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "content": [
                        {
                            "type": "text",
                            "text": json.dumps({
                                "success": False,
                                "error": str(exc),
                                "traceback": traceback.format_exc(),
                            }, ensure_ascii=False, indent=2),
                        }
                    ],
                    "isError": True,
                },
            })
    else:
        send_rpc({
            "jsonrpc": "2.0",
            "id": req_id,
            "error": {"code": -32601, "message": f"Método não suportado: {method}"},
        })


def main():
    while True:
        line = sys.stdin.readline()
        if not line:
            break
        line_stripped = line.strip()
        if not line_stripped:
            continue

        if line_stripped.lower().startswith("content-length:"):
            length = int(line_stripped.split(":", 1)[1].strip())
            sys.stdin.readline()
            body = sys.stdin.read(length)
            try:
                req = json.loads(body)
                handle_request(req)
            except Exception as e:
                sys.stderr.write(f"Erro ao processar payload Content-Length: {e}\n")
            continue

        try:
            req = json.loads(line_stripped)
            handle_request(req)
        except Exception as e:
            sys.stderr.write(f"Erro ao processar linha JSON-RPC: {e}\n")


if __name__ == "__main__":
    main()

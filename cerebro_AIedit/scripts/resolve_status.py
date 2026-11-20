#!/usr/bin/env python3
"""
Script de diagnóstico e conexão com o DaVinci Resolve Studio.
Lê versão, página atual, projeto aberto, estrutura de Bins (Media Pool),
clipes (com metadados básicos e cor) e timelines existentes.
"""

import json
import sys

try:
    import DaVinciResolveScript as dvr_script
except ImportError:
    sys.path.append("/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/Modules/")
    import DaVinciResolveScript as dvr_script


def inspect_folder(folder, depth=0):
    """Percorre recursivamente as pastas (Bins) do Media Pool."""
    clips = folder.GetClipList() or []
    clip_summaries = []
    for clip in clips:
        props = clip.GetClipProperty() or {}
        meta = clip.GetMetadata() or {}
        clip_summaries.append({
            "name": clip.GetName(),
            "type": props.get("Type", ""),
            "fps": props.get("FPS", ""),
            "resolution": props.get("Resolution", ""),
            "duration": props.get("Duration", ""),
            "clip_color": clip.GetClipColor() or "None",
            "camera_type": meta.get("Camera Type", "") or props.get("Camera Type", ""),
            "codec": props.get("Video Codec", ""),
        })

    subfolders = folder.GetSubFolderList() or []
    return {
        "name": folder.GetName(),
        "clip_count": len(clips),
        "clips": clip_summaries,
        "subfolders": [inspect_folder(sub, depth + 1) for sub in subfolders],
    }


def main():
    resolve = dvr_script.scriptapp("Resolve")
    if not resolve:
        print(json.dumps({
            "connected": False,
            "error": "Não foi possível conectar ao DaVinci Resolve. Verifique se está aberto e se External Scripting está em 'Local'."
        }, ensure_ascii=False, indent=2))
        sys.exit(1)

    project_manager = resolve.GetProjectManager()
    project = project_manager.GetCurrentProject() if project_manager else None

    info = {
        "connected": True,
        "product_name": resolve.GetProductName(),
        "version": resolve.GetVersionString(),
        "current_page": resolve.GetCurrentPage(),
        "current_database": project_manager.GetCurrentDatabase() if project_manager else None,
        "project": None,
    }

    if project:
        media_pool = project.GetMediaPool()
        root_folder = media_pool.GetRootFolder() if media_pool else None
        timeline_count = project.GetTimelineCount()
        current_timeline = project.GetCurrentTimeline()

        timelines = []
        for idx in range(1, timeline_count + 1):
            tl = project.GetTimelineByIndex(idx)
            if tl:
                markers = tl.GetMarkers() or {}
                timelines.append({
                    "index": idx,
                    "name": tl.GetName(),
                    "start_timecode": tl.GetStartTimecode(),
                    "video_tracks": tl.GetTrackCount("video"),
                    "audio_tracks": tl.GetTrackCount("audio"),
                    "subtitle_tracks": tl.GetTrackCount("subtitle"),
                    "marker_count": len(markers),
                    "markers": markers,
                })

        info["project"] = {
            "name": project.GetName(),
            "fps": project.GetSetting("timelineFrameRate"),
            "resolution": f"{project.GetSetting('timelineResolutionWidth')}x{project.GetSetting('timelineResolutionHeight')}",
            "current_timeline": current_timeline.GetName() if current_timeline else None,
            "timeline_count": timeline_count,
            "timelines": timelines,
            "media_pool_root": inspect_folder(root_folder) if root_folder else None,
        }

    print(json.dumps(info, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    import os
    main()
    os._exit(0)

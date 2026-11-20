#!/usr/bin/env python3
"""
Cérebro AI Edit — Zerar Timeline
Limpa todos os clipes de todas as faixas (vídeo, áudio, legendas) da timeline ativa
e reduz a timeline para exatamente:
  - 1 faixa de vídeo (V1)
  - 1 faixa de áudio estéreo (A1)
"""

import sys

def reset_timeline():
    import DaVinciResolveScript as dvr
    resolve = dvr.scriptapp('Resolve')
    if not resolve:
        print("Erro: Não foi possível conectar ao DaVinci Resolve Studio.")
        sys.exit(1)

    project = resolve.GetProjectManager().GetCurrentProject()
    if not project:
        print("Erro: Nenhum projeto aberto no DaVinci Resolve.")
        sys.exit(1)

    timeline = project.GetCurrentTimeline()
    if not timeline:
        print("Erro: Nenhuma timeline aberta no DaVinci Resolve.")
        sys.exit(1)

    timeline_name = timeline.GetName()
    print(f"Zerando timeline: '{timeline_name}'...")

    # 1. Apagar todos os clipes de todas as faixas
    all_items = []
    for track_type in ['video', 'audio', 'subtitle']:
        track_count = timeline.GetTrackCount(track_type)
        for idx in range(1, track_count + 1):
            items = timeline.GetItemListInTrack(track_type, idx) or []
            all_items.extend(items)

    if all_items:
        timeline.DeleteClips(all_items, False)
        print(f"  - {len(all_items)} clipes removidos.")
    else:
        print("  - Nenhum clipe para remover.")

    # 2. Reduzir faixas de vídeo para exatamente 1 (V1)
    video_tracks = timeline.GetTrackCount('video')
    for idx in range(video_tracks, 1, -1):
        timeline.DeleteTrack('video', idx)
    if timeline.GetTrackCount('video') == 0:
        timeline.AddTrack('video')

    # 3. Ajustar faixas de áudio: garantir 1 faixa A1 do tipo Stereo
    # Se A1 não for stereo, adiciona uma nova stereo e remove as outras
    audio_tracks = timeline.GetTrackCount('audio')
    # Deletar faixas extras de trás para frente até sobrar 1
    for idx in range(audio_tracks, 1, -1):
        timeline.DeleteTrack('audio', idx)

    # Verificar se A1 é stereo
    a1_type = timeline.GetTrackSubType('audio', 1) if timeline.GetTrackCount('audio') >= 1 else None
    if a1_type != 'stereo':
        # Adicionar uma stereo e remover a anterior se existir
        timeline.AddTrack('audio', 'stereo')
        if timeline.GetTrackCount('audio') > 1:
            timeline.DeleteTrack('audio', 1)

    # 4. Reduzir faixas de legendas se houver
    sub_tracks = timeline.GetTrackCount('subtitle')
    for idx in range(sub_tracks, 0, -1):
        timeline.DeleteTrack('subtitle', idx)

    v_final = timeline.GetTrackCount('video')
    a_final = timeline.GetTrackCount('audio')
    a1_format = timeline.GetTrackSubType('audio', 1) if a_final >= 1 else 'none'

    print(f"Timeline '{timeline_name}' zerada com sucesso:")
    print(f"  - Faixas de Vídeo: {v_final} (V1)")
    print(f"  - Faixas de Áudio: {a_final} (A1 - {a1_format})")

if __name__ == '__main__':
    import os
    reset_timeline()
    os._exit(0)

#!/usr/bin/env python3
"""
Script de Teste de Controle ao Vivo no DaVinci Resolve Studio:
1. Muda para a página 'edit'
2. Cria a estrutura padrão de Bins no Media Pool (evitando duplicatas)
3. Cria uma timeline 'TL_01_TESTE_CONTROLE' dentro do Bin '05_TIMELINES'
4. Insere um gerador/título de teste na timeline e aplica cor 'Purple' (padrão BMPCC 4K; Olympus usa 'Navy')
5. Renomeia as tracks de Vídeo e Áudio
6. Adiciona Markers coloridos de revisão/decupagem na timeline e no clipe
"""

import json
import sys

try:
    import DaVinciResolveScript as dvr_script
except ImportError:
    sys.path.append("/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/Modules/")
    import DaVinciResolveScript as dvr_script


BINS_PADRAO = [
    "00_seqs",
    "01_raw",
]


def get_or_create_subfolder(media_pool, parent_folder, name):
    existing = parent_folder.GetSubFolderList() or []
    for sub in existing:
        if sub.GetName() == name:
            return sub, False
    created = media_pool.AddSubFolder(parent_folder, name)
    return created, True


def main():
    resolve = dvr_script.scriptapp("Resolve")
    if not resolve:
        print(json.dumps({"success": False, "error": "Falha ao conectar ao DaVinci Resolve Studio."}, ensure_ascii=False))
        sys.exit(1)

    project = resolve.GetProjectManager().GetCurrentProject()
    if not project:
        print(json.dumps({"success": False, "error": "Nenhum projeto aberto no DaVinci Resolve."}, ensure_ascii=False))
        sys.exit(1)

    actions = []

    # 1. Mudar para a página Edit
    resolve.OpenPage("edit")
    actions.append(f"Página alterada para: {resolve.GetCurrentPage()}")

    # 2. Criar estrutura de Bins no Media Pool
    media_pool = project.GetMediaPool()
    root_folder = media_pool.GetRootFolder()

    bins_result = {}
    timelines_bin = root_folder
    for bin_name in BINS_PADRAO:
        folder_obj, was_created = get_or_create_subfolder(media_pool, root_folder, bin_name)
        bins_result[bin_name] = "criado" if was_created else "já existia"
        if bin_name == "00_seqs" and folder_obj:
            timelines_bin = folder_obj

    actions.append({"bins": bins_result})

    # 3. Criar ou selecionar Timeline de teste dentro de 05_TIMELINES
    media_pool.SetCurrentFolder(timelines_bin)
    timeline_name = "TL_01_TESTE_CONTROLE"
    timeline = None

    for idx in range(1, project.GetTimelineCount() + 1):
        tl = project.GetTimelineByIndex(idx)
        if tl and tl.GetName() == timeline_name:
            timeline = tl
            break

    if not timeline:
        timeline = media_pool.CreateEmptyTimeline(timeline_name)
        actions.append(f"Timeline '{timeline_name}' criada com sucesso.")
    else:
        project.SetCurrentTimeline(timeline)
        actions.append(f"Timeline '{timeline_name}' já existia e foi selecionada.")

    # 4. Configurar nomes de tracks e adicionar item visual de teste
    if timeline:
        project.SetCurrentTimeline(timeline)
        timeline.SetTrackName("video", 1, "V1_BMPCC4K_MAIN")
        timeline.SetTrackName("audio", 1, "A1_DIALOGO")

        # Verificar se já há item na track V1; se não houver, inserir um gerador de teste
        items_v1 = timeline.GetItemListInTrack("video", 1) or []
        if not items_v1:
            gen_item = timeline.InsertGeneratorIntoTimeline("Solid Color")
            if gen_item:
                gen_item.SetClipColor("Purple")
                gen_item.AddMarker(
                    12,
                    "Purple",
                    "TAKE BMPCC 4K",
                    "Clipe colorido automaticamente com Purple (padrão Blackmagic Pocket 4K)",
                    1,
                    "ai_edit:bmpcc4k_tag",
                )
                actions.append("Gerador 'Solid Color' inserido na V1, pintado de 'Purple' (BMPCC 4K) e marcado.")
        else:
            items_v1[0].SetClipColor("Purple")
            actions.append("Clipe existente na V1 pintado de 'Purple' (BMPCC 4K).")

        # 5. Adicionar Markers de Decupagem / Revisão na Timeline
        timeline.DeleteMarkersByColor("All")
        markers_to_add = [
            (0, "Green", "01 - HOOK / INÍCIO", "Entrada aprovada pelo Cérebro AI Edit", 1, "ai_edit:hook"),
            (24, "Blue", "02 - INSERIR B-ROLL", "Entrar com imagem de cobertura (04_B-ROLL_GFX)", 12, "ai_edit:broll"),
            (48, "Yellow", "03 - AJUSTE DE ÁUDIO", "Revisar nível de voz / aplicar Dialogue Leveler", 1, "ai_edit:audio"),
            (72, "Red", "04 - CORTE DE REVISÃO", "Ponto de corte sugerido no feedback", 1, "ai_edit:cut"),
        ]

        added_markers = 0
        for frame_id, color, name, note, duration, custom_data in markers_to_add:
            ok = timeline.AddMarker(frame_id, color, name, note, duration, custom_data)
            if ok:
                added_markers += 1

        actions.append(f"{added_markers} markers coloridos de decupagem/revisão adicionados à timeline.")

    print(json.dumps({
        "success": True,
        "project": project.GetName(),
        "current_page": resolve.GetCurrentPage(),
        "current_timeline": timeline.GetName() if timeline else None,
        "actions": actions,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    import os
    main()
    os._exit(0)

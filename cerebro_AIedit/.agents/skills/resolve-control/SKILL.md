---
name: resolve-control
description: >-
  Conecta, inspeciona e controla o DaVinci Resolve Studio via servidor MCP unificado
  (davinci-resolve_davinci-resolve) e ResolvePython. Use esta skill para controlar Bins,
  organizar clipes por câmera/cor (BMPCC 4K), criar timelines, usar o Edit Engine (cortes,
  silêncio, J/L cuts, auditoria de ritmo), inspecionar frames em PNG, fazer Color Grading
  (Nodes, LUTs, DCTLs, Stills), Fusion, Fairlight e Render.
---

# Controle Unificado do DaVinci Resolve Studio (`resolve-control`)

Esta skill centraliza a integração com o **DaVinci Resolve Studio 21.1+** através do servidor MCP unificado ([davinci_mcp_server.py](../../mcp/davinci_mcp_server.py)), que une:
1. **9 Ferramentas Exclusivas Cérebro AI Edit** (pensadas para o fluxo **Blackmagic Pocket Cinema Camera 4K** e **Auto-Caption PT-BR**)
2. **37 Compound Tools (`samuelgursky/davinci-resolve-mcp` v5.0.3)** cobrindo **100% dos 336 métodos da API oficial do DaVinci Resolve**, além de Edit Engine, Visão de Frame (`timeline_frame`), LUTs, DCTLs, Fuses e Análise de Mídia.

## Como Usar (Via MCP Nativo)

Prefira sempre chamar as ferramentas do servidor MCP `davinci-resolve_davinci-resolve` via `call_mcp_tool` (após ler o arquivo `.json` correspondente em `/Users/user1/.gemini/antigravity/mcp/davinci-resolve_davinci-resolve/<toolName>.json`).

### 1. Ferramentas Rápidas Cérebro AI Edit (Fluxo Gonc / ISB & Audiovisual Musical)
- `resolve_get_status`: Diagnóstico completo do projeto aberto, árvore de Bins, clipes e timelines.
- `resolve_open_page`: Muda entre `media`, `cut`, `edit`, `fusion`, `color`, `fairlight`, `deliver`.
- `resolve_setup_bins`: Cria os Bins padrão numerados em minúsculas para novos projetos (`00_seqs`, `01_raw`) e, sob demanda, `02_assets`, `03_trilha`, `04_sfx`, além de subpastas de cartões logados dentro de `01_raw` (ex: `olymp_01_chegadaspeech`, `bmpcc4k_passagem`).
- `resolve_import_media`: Importa arquivos/pastas para um Bin específico (suporta caminhos aninhados como `01_raw/olymp_01_chegadaspeech`).
- `resolve_color_clips` / `resolve_organize_and_color_clips`: Pinta clipes automaticamente por câmera/tipo (`Navy` = Olympus, `Purple` = BMPCC 4K, `Pink` = BMPCC 6K, `Olive` = Panasonic Lumix S9, `Lime` = Sony a6400, `Blue` = Drone DJI Mavic / Cam Extra, `Teal` = PNGs/Motions/Assets, `Green` = Trilha/SFX). **Regra**: Ao colorir arquivos, **nunca os mude de pasta**, apenas adicione a cor onde estiverem. Quando acionado `"Organizar Media Pool"` (`move_to_bins=True`), cria/move apenas `00_seqs`, `02_assets`, `03_trilha` e `04_sfx`, mantendo arquivos de câmera e pastas/itens não identificados 100% intocados.
- `resolve_create_timeline`: Cria timelines em `00_seqs` e nomeia as tracks padrão.
- `resolve_append_to_timeline`: Adiciona clipes ou subclipes (`start_frame` / `end_frame`) à timeline.
- `resolve_manage_markers`: Lista, adiciona ou limpa markers coloridos de decupagem e revisão.
- `resolve_create_subtitles`: Gera legendas automáticas em Português (`AUTO_CAPTION_PORTUGUESE`).

### 2. Ferramentas Compostas Avançadas (`samuelgursky/davinci-resolve-mcp` v5.0.3)
Cada ferramenta abaixo recebe `action` (string) e `params` (objeto opcional):
- **Edição e IA**: `edit_engine`, `timeline`, `timeline_item`, `timeline_ai`, `timeline_frame` (retorna PNG do frame atual!), `timeline_markers`, `timeline_item_markers`, `timeline_item_takes`, `timeline_versioning`
- **Media Pool e Análise**: `media_pool`, `folder`, `media_pool_item`, `media_pool_item_markers`, `media_storage`, `media_analysis`
- **Color Grading & Look**: `graph` (Nodes), `timeline_item_color` (CDL, LUTs, versões de cor), `color_group`, `gallery`, `gallery_stills`, `lut` (geração e leitura de `.cube`), `dctl` (criação e validação de DCTLs)
- **Fusion & Plugins**: `fusion_comp`, `timeline_item_fusion`, `fuse_plugin`, `script_plugin`
- **Projeto, Sistema e Render**: `project_manager`, `project_manager_folders`, `project_manager_database`, `project_manager_cloud`, `project_settings`, `render`, `render_presets`, `layout_presets`, `resolve_control`, `setup`, `knowledge`

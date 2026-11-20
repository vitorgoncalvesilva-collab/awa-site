# Cérebro AI Edit — Regras e Contexto Permanente (DaVinci Resolve Studio)

## Perfil do Usuário & Ambiente
- **Nome**: **Vitor Gonçalves** (aka **Vitor Gonc** — chamar de **Gonc** ou **Vitor**).
- **Atuação Profissional**: Diretor de Fotografia (DoP), Operador de Câmera, Produtor ocasional e Editor ("mais do que gostaria" — objetivo principal deste Cérebro AI Edit é aliviar a carga operacional de montagem e edição).
- **Nicho e Projetos Principais**:
  - **Audiovisual Musical**: Shows multicâmera, gravações em estúdio com múltiplos takes da mesma música e videoclipes criativos/narrativos.
  - **Instrumental Sesc Brasil (Safra 2026 em diante)**: Direção de audiovisual e entrevistas para os **minidocs de 2 a 5 minutos** exibidos antes dos shows ao vivo (produção da produtora atual, formato enxuto e sem relação com edições anteriores a 2026 ou com o antigo programa *Passagem de Som*).
  - **Papel do PGM (Passagem de Som / Palco)**: Vídeo gravado com os cortes ao vivo das câmeras do palco sincronizado com o **áudio direto da mesa de som**. Usado primordialmente como **referência máster de áudio** (trilhas musicais da passagem, falas e passagens de música) e, secundariamente, como fonte de takes/cortes visuais quando necessário.

## Fluxo de Decupagem de PGM (Método Gonc)
1. **Identificação Musical**: Localizar com precisão o início e término das execuções musicais completas/trechos de música no PGM.
2. **Fatiamento (Split)**: Cortar a timeline exatamente na entrada e saída de cada música.
3. **Mute / Disable Visual**: Desativar clipes (`clip.SetProperty("Clip Enabled", False)` ou via API) nos trechos de intervalo/conversa sem música, deixando-os visualmente cinzas (desabilitados) para que a timeline mostre de relance apenas os blocos musicais ativos.

## Gatilho "Zerar Timeline" (Reset Completo)
- Sempre que o usuário pedir **"zerar timeline"** (ou resetar a timeline ativa):
  1. **Apagar todos os clipes** de todas as faixas (vídeo, áudio e legendas).
  2. **Reduzir faixas de vídeo** para exatamente **1 faixa de vídeo (`V1`)**.
  3. **Reduzir faixas de áudio** para exatamente **1 faixa de áudio (`A1`)** configurada como **Stereo**.
  4. Remover faixas de legendas ou faixas extras remanescentes.
  5. Script de referência: `scripts/reset_timeline.py`.

## Fluxo de Decupagem de Entrevista / Speech (Método Gonc)
1. **Identificação Pergunta vs. Resposta**:
   - **Pergunta (Entrevistador / Vitor Gonc)**: Feita de trás da câmera, sem o entrevistado em destaque vocal. Deve ser **fatiada e DESATIVADA (`Clip Disabled`)**, ficando cinza e muda na timeline.
   - **Resposta (Entrevistado / Artista / A-Roll)**: A pessoa no enquadramento respondendo e desenvolvendo seu pensamento. Permanece **ATIVA** na timeline.
2. **Resultado Visual**: A timeline de decupagem de entrevista mostra visualmente ativo apenas o conteúdo aproveitável (as respostas do artista), enquanto as perguntas do diretor/entrevistador ficam preservadas no lugar, porém silenciadas e desabilitadas.
3. **Equalização e Mapeamento de Áudio de Entrevista (Dual-Mono do Entrevistado)**:
   - Em captações com kit sem fio duplo (lapela do entrevistado + mic do entrevistador/câmera gravados em L e R):
   - O canal do entrevistado é detectado automaticamente via análise acústica RMS/Peak (o canal com maior ganho/presença e consistência vocal).
   - O áudio da timeline é remapeado para **Dual-Mono** (`"channel_idx": [ch, ch]`), fazendo com que **ambos os lados estéreo (L e R) reproduzam com clareza o microfone do entrevistado**, eliminando ruídos, chiados ou perguntas vazadas do outro canal.
   - Script oficial de automação: `scripts/detect_and_fix_interview_audio.py`.
- **Câmeras Principais**:
  - **Olympus OM-D E-M1 Mark II** (`4K 23.98 fps`): Câmera principal nos minidocs e entrevistas.
  - **Blackmagic Pocket Cinema Camera 4K (BMPCC 4K)**: Usada em materiais específicos e projetos dedicados.
- **Idioma padrão**: Português (pt-BR).
- **Software**: **DaVinci Resolve Studio** (licença perpétua ativa via **BMPCC 4K**).
- **Configuração de Scripting**: `External scripting using: Local` ativado nas preferências do DaVinci Resolve.
- **Interpretador Oficial**: `/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Applications/ResolvePython` (Python 3.14 embutido com `DaVinciResolveScript` pré-configurado).
  - **Atalho no Workspace**: `bin/resolve-python` (executável wrapper que sempre invoca o interpretador correto da Blackmagic, blindando contra erros de arquitetura do Python de sistema do macOS).
  - **Regra de Término Limpo de Scripts**: Scripts que importam `DaVinciResolveScript` devem terminar com `os._exit(0)` para evitar o crash de teardown (`PAC_EXCEPTION` em `fusionscript.so`) no Apple Silicon ao fechar a conexão.
- **Documentação e Stubs da API**:
  - `/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/README.md`
  - `/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting/DaVinciResolveScript.pyi`
- **Execução de Comandos**: Como o DaVinci Resolve Studio se comunica via socket local (porta TCP `1144`), chamadas ao `ResolvePython` que se conectam ao app precisam de `BypassSandbox: true` caso o sandbox bloqueie a conexão IPC/rede local.

## Padrões de Nomenclatura, Organização e Edição
1. **Regra Geral de Caixa (Case Convention)**:
   - Usar **minúsculas (`lowercase`) sempre que possível** em nomes de pastas, bins e estruturas base.
   - Reservar **CAPS (MAIÚSCULAS)** exclusivamente para **evidenciar detalhes específicos, siglas, orientação ou destaques** (ex: `LT_H_pimpa.mov`, `LT_V_breed.mov`, onde `LT` = Lower Third e `H`/`V` = Horizontal/Vertical; códigos de projeto `ISB`; nomes de artistas em pastas raiz como `36_PIMPA_02112026`).
2. **Estrutura Padrão de Bins (Media Pool) e Regra de Organização de Projeto**:
   - **Bins Base Obrigatórios (para qualquer novo projeto)**:
     - `00_seqs` — Todas as timelines / sequências do projeto (sempre no topo com prefixo `00_`).
     - `01_raw` — Todos os arquivos brutos de câmera.
       - Dentro de `01_raw`, ficam as **subpastas de cada cartão logado**, sempre em minúsculas no formato `<camera>_<ordem_cartao>_<assunto/momento>` ou `<camera>_<assunto>` (ex: `olymp_01_chegadaspeech`, `olymp_02_passagem`, `bmpcc4k_passagem`, `a6400_01`).
       - **Pastas com `speech`**: Indicam que o cartão continha a gravação da entrevista, mas **podem conter tanto takes de depoimento quanto takes de B-Roll**. Apenas os takes onde a pessoa está efetivamente dando o depoimento/falando para a câmera são considerados **A-Roll**; os demais takes gravados no mesmo cartão são B-Roll.
       - Arquivos da Olympus seguem o prefixo customizado `GONC0001.MOV`, `GONC0002.MOV`, etc.
   - **Bins Padrão Sob Demanda (criados automaticamente quando houver arquivos correspondentes no projeto)**:
     - `02_assets` — Sempre que houver **PNGs, stills, motions (`LT_H_*`, `LT_V_*`, exports do After Effects, vinhetas) ou assets diversos**, criar `02_assets` e colocá-los lá dentro como regra.
     - `03_trilha` — Músicas e trilhas sonoras.
     - `04_sfx` — Efeitos sonoros (SFX, risers, hits, ambiências).
   - **Regra de Preservação Intocada e Botões do Painel**:
     - Ao organizar um projeto (ex: ao acionar o botão **`"Organizar Media Pool"`**), **arquivos e pastas não identificados** (ou subpastas de cartões logados já estruturadas dentro de `01_raw`) devem permanecer **100% intocados onde estiverem**, movendo apenas os itens claramente direcionados às pastas padrão (`00_seqs`, `01_raw`, `02_assets`, `03_trilha`, `04_sfx`).
     - Os botões do painel do plugin (`suggestedPrompts` em `plugin.json`) devem ter títulos sempre curtos e objetivos (ex: `"Organizar Media Pool"`, `"Speech-Splits"`).
     - **Gatilho `"Speech-Splits"`**: Decupa automaticamente as entrevistas na timeline ativa separando perguntas de respostas (desativando os trechos com as perguntas do diretor/entrevistador e mantendo ativas as falas do entrevistado em Dual-Mono).
   - **Regra de Uso de Proxy para Análise**:
     - Sempre que um arquivo possuir versão em **Proxy** (`Proxy Media Path` disponível e existente no disco), **dar sempre preferência a essa versão reduzida** para qualquer tipo de análise (áudio, RMS, transcrição, detecção de silêncio, visão computacional ou decupagem), acelerando exponencialmente a leitura e o processamento de I/O.
   - **Regra de Alpha Mode em Motions (`.mov`)**:
     - Sempre que adicionar ou importar um motion em `.mov` (ou qualquer clipe com canal alfa) que estiver com `Alpha mode` configurado como `Premultiplied`, **aplicar `Straight`** (`SetClipProperty("Alpha mode", "Straight")`) para que a sobreposição não altere ou escureça a cor/brilho do vídeo que está por baixo.
   - **Regra de Auto-Legendas e Revisão Harmônica (Regra Gonc)**:
     - Ao gerar legendas automáticas no DaVinci Resolve Studio, usar sempre **detecção automática de idioma (`AUTO_CAPTION_AUTO`)** como padrão.
     - **Padrões Estéticos ISB (Instrumental Sesc Brasil)**:
       - **Vídeos Horizontais**: Presete/Estilo **`SESC_isb_H`**
       - **Vídeos Verticais (Reels/Stories)**: Presete/Estilo **`SESC_isb_V`**
     - **Critério Harmônico de Quebra de Frase e Timing**:
       - Nunca deixar conjunções ou preposições soltas/penduradas no final de uma legenda quando a frase continua na seguinte (ex: `..., mas`, `... porque`, `... da`, `... de`, `... que`, `... com`).
       - Separar frase a frase respeitando as pausas naturais da fala, o fôlego do entrevistado e o timing do áudio.
       - Exemplo prático: em vez de `[1] "Então, eu sou Luan Sodré, sou músico, mas"` e `[2] "também professor."`, estruturar como: `[1] "Então, eu sou Luan Sodré, sou músico,"` e `[2] "mas também professor."`.
       - Revisar termos contextuais e erros de transcrição fonética (ex: *Césculo* -> *Sesc*, *comódia* -> *commodity*, *cruzilhada* -> *encruzilhada*, capitalização de nomes como *Marcos*, *Marcelo Pinho*).
3. **Padrão de Cores por Câmera / Tipo (`ClipColor`) — REGRA: Colorir sem mover de pasta**:
   - **Regra Obrigatória**: Quando for colorir arquivos, **apenas adicione a cor (`ClipColor`), NUNCA mude os arquivos de pasta/lugar**.
   - **Olympus OM-D E-M1 Mark II (`GONC*.MOV` / `olymp_*`)**: `Navy` (sempre)
   - **Blackmagic Pocket Cinema Camera 4K (BMPCC 4K / `bmpcc4k_*`)**: `Purple` (sempre)
   - **Blackmagic Pocket Cinema Camera 6K (BMPCC 6K / `bmpcc6k_*`)**: `Pink` (sempre)
   - **Panasonic Lumix S9 (`P10*.MOV` / `s9_*`)**: `Olive` (sempre)
   - **Sony Alpha a6400 (`a6400_*`)**: `Lime` (sempre)
   - **Drone DJI Mavic / Tomadas Aéreas (`DJI_*.MP4` / `mavic*`)**: `Blue` (sempre)
   - **Câmeras Secundárias / Extras não listadas (`a7s_*`, `gopro_*`, etc.)**: `Blue`
   - **Assets / Motions / PNGs (`02_assets`, `LT_*`)**: `Teal`
   - **Trilha (`03_trilha`) / SFX (`04_sfx`) / Áudio**: `Green`
   - **Takes Aprovados / Selecionados**: `Lime`
3. **Padrão de Cores de Markers (`MarkerColor`) para Decupagem e Feedback**:
   - `Green`: Melhor Take / Hook aprovado
   - `Blue`: Ponto de inserção de B-Roll / Imagem de cobertura
   - `Yellow`: Atenção / Ajuste de Áudio ou Transição
   - `Red`: Corte necessário / Erro / Feedback de revisão
   - `Purple`: Nota de Cor / Grading (BMPCC 4K)

## Evolução Contínua (Skills)
- Novos fluxos aprendidos e validados devem ser documentados e salvos em `.agents/skills/<nome-da-skill>/SKILL.md` com scripts reutilizáveis em `scripts/`.

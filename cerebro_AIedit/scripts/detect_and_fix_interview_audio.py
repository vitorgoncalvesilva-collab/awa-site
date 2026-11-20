#!/usr/bin/env python3
"""
Cérebro AI Edit — Detecção e Equalização Automática de Áudio de Entrevista (Dual-Mono do Entrevistado)
Identifica qual canal (Canal 1 / L ou Canal 2 / R) contém a voz do entrevistado analisando
o nível de energia (RMS / Peak) e mapeia a timeline ou clipe para dual-mono [ch, ch].
"""

import sys
import os
import subprocess
import struct
import math
import json

def get_channel_rms(file_path):
    """Lê o arquivo de vídeo/áudio usando afconvert nativo do macOS e calcula RMS por canal."""
    tmp_caf = f"/tmp/ai_edit_eval_{os.getpid()}.caf"
    cmd = ['/usr/bin/afconvert', '-f', 'caff', '-d', 'LEI16@48000', '-c', '2', file_path, tmp_caf]
    res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if res.returncode != 0 or not os.path.exists(tmp_caf):
        return None, None
    
    try:
        with open(tmp_caf, 'rb') as f:
            data = f.read()
    finally:
        if os.path.exists(tmp_caf):
            os.remove(tmp_caf)
            
    idx = 8
    raw = b''
    while idx < len(data):
        mtype = data[idx:idx+4]
        msize = struct.unpack('>q', data[idx+4:idx+12])[0]
        if mtype == b'data':
            raw = data[idx+16 : idx+12+msize] if msize > 0 else data[idx+16:]
            break
        idx += 12 + max(0, msize)
        
    count = len(raw) // 4
    if count == 0:
        return None, None
        
    sum_sq1, sum_sq2 = 0, 0
    peak1, peak2 = 0, 0
    for i in range(0, count * 4, 4):
        s1, s2 = struct.unpack_from('<hh', raw, i)
        sum_sq1 += s1 * s1
        sum_sq2 += s2 * s2
        if abs(s1) > peak1: peak1 = abs(s1)
        if abs(s2) > peak2: peak2 = abs(s2)

    rms1 = math.sqrt(sum_sq1 / count)
    rms2 = math.sqrt(sum_sq2 / count)
    db1 = 20 * math.log10(rms1 / 32768) if rms1 > 0 else -100
    db2 = 20 * math.log10(rms2 / 32768) if rms2 > 0 else -100
    return db1, db2

def main():
    import DaVinciResolveScript as dvr
    resolve = dvr.scriptapp('Resolve')
    if not resolve:
        print("Erro: Não foi possível conectar ao DaVinci Resolve.")
        sys.exit(1)
        
    project = resolve.GetProjectManager().GetCurrentProject()
    if not project:
        print("Erro: Nenhum projeto aberto.")
        sys.exit(1)
        
    timeline = project.GetCurrentTimeline()
    if not timeline:
        print("Erro: Nenhuma timeline aberta.")
        sys.exit(1)
        
    print(f"Analisando áudio na timeline: {timeline.GetName()}")
    audio_items = timeline.GetItemListInTrack('audio', 1)
    if not audio_items:
        print("Nenhum clipe de áudio encontrado na Track 1.")
        sys.exit(0)
        
    # Amostrar clips
    ch1_votes = 0
    ch2_votes = 0
    details = []
    
    for item in audio_items:
        mpi = item.GetMediaPoolItem()
        if not mpi:
            continue
        # Preferência por Proxy Media Path para análise rápida quando disponível
        proxy_path = mpi.GetClipProperty('Proxy Media Path')
        raw_path = mpi.GetClipProperty('File Path')
        path = proxy_path if (proxy_path and os.path.exists(proxy_path)) else raw_path
        if not path or not os.path.exists(path):
            continue
        db1, db2 = get_channel_rms(path)
        if db1 is not None and db2 is not None:
            diff = db2 - db1
            dominant = 2 if diff > 0 else 1
            if dominant == 2:
                ch2_votes += 1
            else:
                ch1_votes += 1
            details.append((item.GetName(), db1, db2, dominant, diff))
            
    if not details:
        print("Não foi possível analisar os arquivos de mídia.")
        sys.exit(1)
        
    chosen_channel = 2 if ch2_votes >= ch1_votes else 1
    print(f"\nResultado da Análise Acústica:")
    for name, db1, db2, dom, diff in details:
        print(f"  - {name}: Ch1={db1:.1f}dBFS | Ch2={db2:.1f}dBFS -> Dominante Canal {dom} (dif: {abs(diff):.1f}dB)")
        
    print(f"\nCanal do Entrevistado detectado: Canal {chosen_channel} (votos: Ch1={ch1_votes}, Ch2={ch2_votes})")
    
    # Montar schema de mapeamento stereo dual-mono
    target_mapping = {
        'embedded_audio_channels': 2,
        'linked_audio': {},
        'track_mapping': {
            '1': {
                'channel_idx': [chosen_channel, chosen_channel],
                'mute': False,
                'type': 'stereo'
            }
        }
    }
    mapping_json = json.dumps(target_mapping)
    
    updated = 0
    for item in audio_items:
        if item.SetSourceAudioChannelMapping(mapping_json):
            updated += 1
            
    print(f"\nSucesso: {updated}/{len(audio_items)} clipes na timeline foram mapeados para Canal {chosen_channel} Dual-Mono ([{chosen_channel}, {chosen_channel}]).")

if __name__ == '__main__':
    import os
    main()
    os._exit(0)

# ÀWA — Cinema & Produtora Autoral

Workspace oficial para desenvolvimento do site da **ÀWA**.

## Diretrizes de Identidade Visual Incorporadas
- [Guia Completo da Identidade da Marca (ID_AWA_BRAND_GUIDE.md)](./ID_AWA_BRAND_GUIDE.md)
- Assets vetoriais e pranchas em `./assets/brand/`

### Núcleo da Identidade
- **Conceito Ancestral**: *Àwa* (Iorubá) = **"Nós" / "Nós somos"**. Autoria coletiva de cinema, de dentro para fora.
- **Símbolo**: Estrela aberta de 8 pontas em fitas entrelaçadas (*Aso Oke* e *Irun Didi* - Nó Infinito). Centro vazado como roda comunitária e diafragma/obturador cinematográfico.
- **Tipografia**: Wordmark "ÀWA" com acento grave angular afiado no primeiro À e letras entrelaçadas. Subtítulo "PRODUTORA" foi excluído.
- **Estética & Paleta**: Monocromático absoluto (`#FFFFFF` sobre `#000000`), estética minimalista contemporânea de cinema autoral (estilo A24 / NEON).
- **Proporção Real de Set**: Aplicações discretas, elegantes e com precisão óptica de película e profundidade de campo.


## Pipeline de Curadoria & Ingestão de Takes (Regra Oficial)
- **Extração Completa sem Repetições**: Ao processar um filme finalizado no DaVinci Resolve (`AWA_site_acervo`), extrair **todos os quadros/planos diferentes** detectados por corte, excluindo apenas repetições diretas do mesmo plano.
- **Desempate de Takes Semelhantes**: Quando houver takes parecidos ou variações do mesmo enquadramento, apresentar uma seleção comparativa para o usuário decidir quais sobem para o acervo final e quais ficam de fora.

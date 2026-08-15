# Gesture Ink

Uma lousa digital controlada por gestos da mão, diretamente no navegador.

## Como iniciar

Por segurança, navegadores só liberam a webcam em `localhost` ou HTTPS. Abra um terminal nesta pasta e use uma destas opções:

No Windows, dê dois cliques em **`iniciar.bat`**. A página será aberta automaticamente.

Alternativamente, execute `node server.js` nesta pasta.

Depois acesse `http://localhost:8080` e permita o uso da câmera.

## Gestos

- **Indicador levantado:** desenhar.
- **Mão aberta:** apagar na região da palma.
- **Pinça (polegar + indicador):** selecionar e arrastar o traço mais próximo.

Também é possível escolher cor e espessura, desfazer/refazer, pausar com Espaço e salvar em PNG.

## Experiência interativa

- Pincéis neon, arco-íris, estrelas, bolhas, fogo e clássico.
- Correção automática de círculos, quadrados e triângulos.
- Preenchimento de áreas fechadas usando pinça.
- Desafios educativos, histórias curtas, pontuação e comemorações.
- Objetos que ganham movimento, duplicação e encaixe de traços.
- Duas pinças para redimensionar e girar desenhos.
- Comandos de voz em português, galeria local e área dos responsáveis.

O vídeo é processado localmente pelo MediaPipe e não é enviado para um servidor. A primeira abertura precisa de internet para carregar o modelo de reconhecimento.

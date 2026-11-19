# Alma do Carro (Bolt Performance + Alma)

Abra `Alma_do_Carro.html` direto no Chrome (ou copie para a multimídia). Este projeto-fonte (módulos ES) roda
por `node server.js` ou qualquer servidor estático; o arquivo único é gerado por `bundle.mjs`.

- Fotos do veículo: botão "Foto" no painel ou Garagem > editar > Aparência. Ficam só no aparelho.
- IA do Claude: funciona quando o app roda dentro do Claude; fora dele, falas locais (ou backend com `server.js`).
- Voz: Configurações > Assistente > "Testar voz" mostra o motivo se a voz não sair.

## Modo espera (protetor de tela do Bolt)

Mostra só a cara do Bolt (os olhos), sem distração, para quem está dirigindo.

- **Entrar:** botão "Modo espera" no painel, em Configurações > Assistente, por voz ("Bolt, modo espera" ou "protetor de tela"), ou sozinho depois de alguns minutos sem tocar na tela (Configurações > Assistente > Modo espera; padrão 3 min, pode desligar).
- **Sair:** dois toques na tela, deslizar para cima, ou dizer "sair do modo espera" / "voltar ao painel".
- **Rosto:** pisca e dá piscadinhas, olha de lado de vez em quando, e muda conforme o estado: dormindo (motor desligado), pronto, ouvindo, pensando, falando, atenção (âmbar) e alerta (vermelho).
- **Alertas:** continuam sendo falados exatamente como antes (mesmo nível de comunicação das Configurações). No modo espera ganham legenda na tela, e um aviso fica fixo no topo enquanto o alerta estiver ativo (toque nele para abrir os alertas).
- **Microfone:** botão na parte de baixo liga e desliga a escuta por nome. Quando está ouvindo, diga "Bolt".
- **Chamar o Bolt:** ao dizer só "Bolt" (ou "Bolt, tá na escuta?"), ele responde na hora, sem esperar o fim da frase ("Presente, Jorge. Pode falar."), e a frase seguinte já vale sem repetir o nome. Se você falar o nome e a pergunta juntos ("Bolt, qual a temperatura"), ele espera a pergunta.
- Arquivos: `standby.js`, `standby.css`; ajustes em `voice.js`, `assistant.js`, `app.js`, `view-dashboard.js`, `view-settings.js`, `config.js`.
- Testes: `npm test` (escuta por nome e comandos de voz).

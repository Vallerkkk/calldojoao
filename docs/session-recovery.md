# Recuperação de sessão no aplicativo

O aplicativo Windows usa a mesma interface do site, em uma sessão de login independente do navegador. Não é necessário reinstalar para receber esta correção: recarregue com Ctrl+R.

Ao retomar a janela, voltar da suspensão ou recuperar a conexão, a interface verifica a sessão. Tokens próximos de expirar são renovados antes de uma chamada. Uma resposta 401 de uma API provoca uma única renovação e uma única tentativa adicional. Requisições simultâneas compartilham a renovação; uma troca de conta cancela a operação anterior.

Quando o login é confirmado como inválido ou revogado, a interface fecha diálogos, sai da tela cheia da chamada e do modo Big Picture e mostra o formulário de entrada. O logout é somente local. Uma falha de rede não é tratada como revogação. Rascunhos da conta são preservados.

Os testes cobrem renovação, revogação, indisponibilidade de rede, retomada da janela, falha durante a abertura, troca de conta e retorno à tela de entrada após tela cheia. Não leem o perfil real do aplicativo nem suas credenciais.

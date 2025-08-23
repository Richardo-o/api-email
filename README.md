"# api-email" 

Na linha abaixo temos uma função converter pedaço de dados vindos de um socket, no qual armazena dados temporariamente.


let buffer é uma variável que recebe dados de socket acumulando dos dados. Os dados que chegam no buffer, vem quebrados.

cont listerners ele vai chamar a função quando uma linha estiver completa no buffer

  function createLineReader(socket) {
  let buffer = "";
  const listeners = [];
  }
_________________________________________________


 const onData = (chunk) => {
    buffer += chunk.toString("utf8");
    let idx;
    while ((idx = buffer.indexOf("\r\n")) >= 0) {
      const line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      listeners.forEach((fn) => fn(line));
    }
  };

 Criar uma variável onData que recebe pedaços (chunks)

let idx declara uma variável que não é constante

no while((idx //recebe o buffer.indexOf // o indexOF ele pega os dados de buffer e caso retorae um numero -1 a função volta para o inicio )) idx basicamente o fim.

após isso é criado uma const line, no qual  ele recorta partes dos indices 
buffer = buffer.slice (idx + 2) o + 2 serve \r\n contando com esses dois caracteres

socket.on("data", onData); -- socket.on é uma chamada que vai ser executada quando houver alguma ação e vai repetir o onData.

  return { -- essa chamada possui um retorno, no qual vai chamar onLine
    onLine(fn) { -- essa função  onLine(fn) basicamente faz uma recursão que volta para listeners e continua pegando as informações que estão quebradas / separadas 
      listeners.push(fn);
    },
    remove() { -- essa função basicamente diz que acabou as mensagens e que não precisa voltar a recursão
      socket.off("data", onData); -- basicamente encerra a função
    },
  };


async function readResponse(socket) {  -- criando uma função assincrona que recebe os parametros de socket

  return new Promise((resolve, reject) => { -- isso retorna uma promessa, no qual tem parametros, sendo resolve e reject.
    const lines = []; -- cria um array constantante chamado lines no qual é um array
    let code = null; -- cria uma variável incostante que o primeiro parametro é nulo
  }
  )}








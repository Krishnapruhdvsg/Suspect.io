const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Server } = require('socket.io');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const MAX_PLAYERS = 12;
const ANSWER_SECONDS = 10;
const VOTE_SECONDS = 20;
const GUESS_SECONDS = 12;
const ROOM_TTL = 2 * 60 * 60 * 1000;
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MIME = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json; charset=utf-8','.png':'image/png','.json':'application/json; charset=utf-8','.txt':'text/plain; charset=utf-8'};
const curated = [
  ['Lantern','I carry a little sun inside me, yet I am most useful when the real one leaves.'],['Ocean','I have a bed but never sleep, and a shore that never stays still.'],['Mirror','I return what I receive, though I keep nothing for myself.'],['Clock','I have a face and two hands, but no eyes and no arms.'],['Library','I am a quiet forest where every tree can speak, if you know how to listen.'],['Thunder','I arrive after a silent flash and make the sky sound enormous.'],['Cactus','I keep my own needles and can wait a long time for a drink.'],['Compass','I point the way without taking a single step.'],['Volcano','A mountain with a temper sleeps until its insides speak.'],['Kite','A string holds me down while the wind lifts me up.'],['Shadow','I follow you in the light but disappear when darkness arrives.'],['Snowflake','I fall from the clouds, wear six-sided lace, and vanish in a warm hand.'],['Telescope','I bring distant fires closer without moving them an inch.'],['Puzzle','I am a picture in pieces that asks your hands to think.'],['Rainbow','I am a bridge of colors that never reaches the other side.'],['Candle','I grow shorter as I brighten the room.'],['Bridge','I join two places by standing between them.'],['Echo','I repeat your words but never begin a conversation.'],['Feather','I once helped a bird fly, and now I drift wherever air decides.'],['Key','I am small, but I can persuade a closed door to change its mind.'],['Garden','I am a place where patient hands invite color from the ground.'],['Desert','I may have an ocean of sand, but water is my rarest visitor.'],['Photograph','I freeze one passing moment and let it live longer.'],['Backpack','I travel on your shoulders while carrying what you need.'],['Fireworks','I bloom in the night, make no seeds, and disappear in a blink.'],['Bicycle','Two circles carry you forward when your feet turn a pair of pedals.'],['Sundial','I have no gears or glass, yet the sun draws the passing hours across my face.'],['Mushroom','I wear a cap but have no head, and after rain I may appear overnight.'],['Jellyfish','I drift through the sea like a bell with trailing ribbons.'],['Satellite','I circle a world while helping people find their way.'],['Origami','A flat sheet becomes a little world through careful folds.'],['Penguin','I wear a tuxedo, waddle on land, and dive like a champion.'],['Teapot','I hold a storm of leaves and pour it out one cup at a time.'],['Anchor','I am heavy enough to keep a traveler from drifting away.'],['Piano','My many teeth make music when a pair of hands dances across them.'],['Meteor','A visitor from space briefly draws a bright line across the night.'],['Sponge','I soak up a mess and give it back when squeezed.'],['Hourglass','I measure a little while by letting a beach fall indoors.'],['Cocoon','A quiet wrapping hides a surprising change.'],['Chameleon','I can borrow the colors around me while keeping my own eyes on you.'],['Quicksand','The more you struggle in me, the harder it can be to get free.']
].map(([word,riddle])=>({word,riddle}));
function loadWordBank(){
  try {
    const source=fs.readFileSync(path.join(ROOT,'assets','wordbank.js'),'utf8');
    const marker='window.SUSPECT_WORD_BANK=';
    const at=source.indexOf(marker);
    const start=at+marker.length;
    const end=source.lastIndexOf(';');
    const dictionary=JSON.parse(source.slice(start,end));
    const seen=new Set(curated.map(x=>x.word.toLowerCase()));
    return [...curated,...dictionary.filter(x=>{const key=String(x.word).toLowerCase();if(seen.has(key))return false;seen.add(key);return true;})];
  } catch(error) { console.error('Word bank could not be loaded:',error.message); return curated; }
}
const wordBank=loadWordBank();
const rooms=new Map();
const socketsToPlayer=new Map();

const server=http.createServer((req,res)=>{
  let pathname;
  try { pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname); }
  catch { res.writeHead(400).end('Bad request'); return; }
  if(pathname==='/') pathname='/index.html';
  const target=path.resolve(ROOT,'.'+pathname);
  if(target!==ROOT&&!target.startsWith(ROOT+path.sep)){res.writeHead(403).end('Forbidden');return;}
  fs.stat(target,(err,stat)=>{
    if(err||!stat.isFile()){res.writeHead(404).end('Not found');return;}
    res.writeHead(200,{'Content-Type':MIME[path.extname(target).toLowerCase()]||'application/octet-stream','Cache-Control':path.extname(target)==='.html'?'no-cache':'public, max-age=3600','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'});
    fs.createReadStream(target).pipe(res);
  });
});
const io=new Server(server,{serveClient:true,transports:['websocket','polling'],maxHttpBufferSize:16_000,pingInterval:15000,pingTimeout:20000});

function code(){let out='';for(let i=0;i<4;i++)out+=ALPHABET[crypto.randomInt(ALPHABET.length)];return out;}
function token(){return crypto.randomBytes(18).toString('base64url');}
function cleanName(value){return String(value||'').trim().replace(/[<>\u0000-\u001f]/g,'').slice(0,16);}
function normalize(value){return String(value||'').normalize('NFD').toLowerCase().replace(/\p{M}/gu,'').replace(/[^\p{L}\p{N}]/gu,'');}
function shuffle(list){for(let i=list.length-1;i>0;i--){const j=crypto.randomInt(i+1);[list[i],list[j]]=[list[j],list[i]];}return list;}
function activePlayers(room){return room.players.filter(p=>p.connected);}
function retainConnectedPlayers(room){room.players=activePlayers(room);}
function safeState(room,player){
  const reveal=room.phase==='vote'||room.phase==='result';
  return {code:room.code,phase:room.phase,roundNo:room.roundNo,secondsLeft:room.secondsLeft,
    isHost:room.hostToken===player.token,selfId:player.id,
    players:room.players.map(p=>({id:p.id,name:p.name,gender:p.gender,avatar:p.avatar,score:p.score,connected:p.connected,
      submitted:room.phase==='answer'?p.answers[room.roundNo]!==null:undefined,
      answers:reveal?p.answers:undefined})),
    mySubmitted:room.phase==='answer'?player.answers[room.roundNo]!==null:false,
    myVote:player.vote,myGuessSubmitted:player.guessSubmitted,
    result:room.result||null
  };
}
function pushState(room){for(const player of room.players)if(player.socketId)io.to(player.socketId).emit('room:state',safeState(room,player));}
function sendPrivate(room,player){if(!player.socketId||!player.role||!room.secret)return;io.to(player.socketId).emit('game:private',{role:player.role,word:player.role==='innocent'?room.secret.word:undefined,riddle:player.role==='mole'?room.secret.riddle:undefined,canGuess:room.caughtMoles?.includes(player.id)||false});}
function emitError(socket,message){socket.emit('game:error',message);}
function bindPlayer(socket,room,player){
  clearTimeout(player.removeTimer);
  const oldId=player.socketId; if(oldId&&oldId!==socket.id){io.to(oldId).emit('room:left');socketsToPlayer.delete(oldId);}
  player.socketId=socket.id;player.connected=true;player.disconnectedAt=0;player.lastSeen=Date.now();
  room.lastActive=Date.now();
  socket.data.roomCode=room.code;socket.data.playerToken=player.token;socketsToPlayer.set(socket.id,{roomCode:room.code,token:player.token});
  socket.join(room.code);pushState(room);sendPrivate(room,player);
}
function sendAckState(room,player,ack){ack?.({ok:true,code:room.code,token:player.token,state:safeState(room,player)});}
function resetRound(room){
  clearInterval(room.timer);room.result=null;room.caughtMoles=[];room.roundNo=0;
  for(const p of room.players){p.role=null;p.answers=[null,null,null];p.vote=null;p.guessSubmitted=false;}
  room.secret=wordBank[crypto.randomInt(wordBank.length)];
  const count=room.players.length>=7?2:1;
  const chosen=new Set(shuffle(room.players.slice()).slice(0,count).map(p=>p.id));
  for(const p of room.players)p.role=chosen.has(p.id)?'mole':'innocent';
  room.phase='answer';startAnswerClock(room);
  for(const p of room.players)sendPrivate(room,p);
  pushState(room);
}
function tick(room){
  clearInterval(room.timer);room.secondsLeft=room.duration;
  const started=Date.now();
  room.timer=setInterval(()=>{
    const left=Math.max(0,Math.ceil(room.duration-(Date.now()-started)/1000));room.secondsLeft=left;
    io.to(room.code).emit('game:tick',{phase:room.phase,secondsLeft:left});
    if(left<=0){clearInterval(room.timer);if(room.phase==='answer')advanceAnswer(room);else if(room.phase==='vote')resolveVote(room);else if(room.phase==='guess')finishRound(room,false,'timeout');}
  },1000);
}
function startAnswerClock(room){room.phase='answer';room.duration=ANSWER_SECONDS;for(const p of room.players)p.answers[room.roundNo]=null;tick(room);}
function advanceAnswer(room){
  if(room.phase!=='answer')return;
  for(const p of room.players)if(p.answers[room.roundNo]===null)p.answers[room.roundNo]='';
  if(room.roundNo<2){room.roundNo++;startAnswerClock(room);pushState(room);return;}
  room.phase='vote';room.duration=VOTE_SECONDS;room.secondsLeft=VOTE_SECONDS;for(const p of room.players)p.vote=null;tick(room);pushState(room);
}
function startGuess(room){room.phase='guess';room.duration=GUESS_SECONDS;room.secondsLeft=GUESS_SECONDS;for(const p of room.players){p.guessSubmitted=false;sendPrivate(room,p);}tick(room);pushState(room);}
function resolveVote(room){
  if(room.phase!=='vote')return;
  clearInterval(room.timer);
  const tally=new Map(room.players.map(p=>[p.id,0]));for(const p of room.players)if(p.vote&&tally.has(p.vote))tally.set(p.vote,tally.get(p.vote)+1);
  const max=Math.max(0,...tally.values());const top=room.players.filter(p=>tally.get(p.id)===max&&max>0).map(p=>p.id);
  const moles=room.players.filter(p=>p.role==='mole');room.caughtMoles=moles.filter(p=>top.includes(p.id)).map(p=>p.id);
  if(room.caughtMoles.length){room.voteTally=Object.fromEntries(tally);startGuess(room);return;}
  finishRound(room,true,'missed');
}
function finishRound(room,moleWon,reason){
  if(room.phase==='result')return;clearInterval(room.timer);
  const moles=room.players.filter(p=>p.role==='mole');
  let correct=[];
  if(!moleWon){const caught=new Set(room.caughtMoles.length?room.caughtMoles:moles.map(p=>p.id));correct=room.players.filter(p=>p.vote&&caught.has(p.vote));}
  const pool=!moleWon?50:0;const base=correct.length?Math.floor(pool/correct.length):0;let extra=correct.length?pool%correct.length:0;
  for(const p of room.players){if(p.role==='mole'){if(moleWon)p.score+=100;}else if(correct.includes(p)){p.score+=base+(extra-->0?1:0);}}
  let message;
  if(reason==='missed')message='The vote missed the mole. The mole slips away!';
  else if(reason==='guess')message='The mole guessed the secret word and stole the win.';
  else if(reason==='timeout')message='The mole ran out of time on the final guess.';
  else message='The group found the mole and shared the points.';
  room.result={moleWon,title:moleWon?'The mole got away.':'The innocents win!',word:room.secret.word,moles:moles.map(p=>p.name),message,reason,correctVoters:correct.map(p=>p.name)};
  room.phase='result';room.secondsLeft=0;pushState(room);
}
function removePlayer(room,player){
  room.players=room.players.filter(p=>p.token!==player.token);
  if(room.hostToken===player.token){const next=room.players.find(p=>p.connected)||room.players[0];room.hostToken=next?.token||null;}
  if(!room.players.length){clearInterval(room.timer);rooms.delete(room.code);return;}
  if(room.phase==='answer'&&player.answers[room.roundNo]===null)player.answers[room.roundNo]='';
  if(room.phase==='vote'&&room.players.every(p=>p.vote!==null))resolveVote(room);
  pushState(room);
}
function resume(socket,data,ack){
  const room=rooms.get(String(data?.code||'').toUpperCase());const player=room?.players.find(p=>p.token===data?.token);
  if(!room||!player){ack?.({ok:false,error:'That room is no longer available.'});return;}
  bindPlayer(socket,room,player);sendAckState(room,player,ack);
}

io.on('connection',socket=>{
  socket.on('room:create',(data={},ack)=>{
    const name=cleanName(data.name);if(!name){ack?.({ok:false,error:'Enter a name to create a room.'});return;}
    let roomCode;do{roomCode=code();}while(rooms.has(roomCode));
    const player={id:crypto.randomUUID(),token:typeof data.token==='string'&&data.token.length<100?data.token:token(),name,gender:data.gender==='female'?'female':'male',avatar:Math.max(0,Math.min(3,Number(data.avatar)||0)),score:0,connected:false,socketId:null,role:null,answers:[null,null,null],vote:null,guessSubmitted:false,lastSeen:Date.now()};
    const room={code:roomCode,hostToken:player.token,players:[player],phase:'lobby',roundNo:0,secondsLeft:0,duration:0,timer:null,createdAt:Date.now(),lastActive:Date.now(),secret:null,caughtMoles:[],result:null};
    rooms.set(roomCode,room);bindPlayer(socket,room,player);sendAckState(room,player,ack);
  });
  socket.on('room:join',(data={},ack)=>{
    const room=rooms.get(String(data.code||'').toUpperCase());const name=cleanName(data.name);
    if(!room){ack?.({ok:false,error:'Room not found. Check the four-letter code.'});return;}
    if(room.phase!=='lobby'){ack?.({ok:false,error:'This round has already started.'});return;}
    if(room.players.length>=MAX_PLAYERS){ack?.({ok:false,error:'This room is full (12 players max).'});return;}
    if(!name){ack?.({ok:false,error:'Enter your name first.'});return;}
    if(room.players.some(p=>p.name.toLowerCase()===name.toLowerCase())){ack?.({ok:false,error:'That name is already in the room.'});return;}
    const player={id:crypto.randomUUID(),token:typeof data.token==='string'&&data.token.length<100?data.token:token(),name,gender:data.gender==='female'?'female':'male',avatar:Math.max(0,Math.min(3,Number(data.avatar)||0)),score:0,connected:false,socketId:null,role:null,answers:[null,null,null],vote:null,guessSubmitted:false,lastSeen:Date.now()};
    room.players.push(player);room.lastActive=Date.now();bindPlayer(socket,room,player);sendAckState(room,player,ack);
  });
  socket.on('room:resume',(data,ack)=>resume(socket,data,ack));
  socket.on('game:start',(data,ack)=>{
    const ref=socketsToPlayer.get(socket.id),room=ref&&rooms.get(ref.roomCode),player=room?.players.find(p=>p.token===ref.token);
    if(!room||!player){ack?.({ok:false,error:'Join a room first.'});return;}
    if(room.hostToken!==player.token){ack?.({ok:false,error:'Only the host can start the round.'});return;}
    if(activePlayers(room).length<3){ack?.({ok:false,error:'At least 3 players must be connected.'});return;}
    room.lastActive=Date.now();retainConnectedPlayers(room);resetRound(room);ack?.({ok:true});
  });
  socket.on('game:answer',(data={},ack)=>{
    const ref=socketsToPlayer.get(socket.id),room=ref&&rooms.get(ref.roomCode),player=room?.players.find(p=>p.token===ref.token);
    if(!room||!player||room.phase!=='answer'){ack?.({ok:false,error:'The answer round is closed.'});return;}
    if(player.answers[room.roundNo]!==null){ack?.({ok:false,error:'Your answer is already locked in.'});return;}
    const word=String(data.word||'').trim();
    if(!word||word.length>25||/\s/.test(word)||!/[\p{L}\p{N}]/u.test(word)){ack?.({ok:false,error:'Use one word, up to 25 characters.'});return;}
    const key=normalize(word);if(key===normalize(room.secret.word)){ack?.({ok:false,error:'Use a related word, not the secret word itself.'});return;}
    if(room.players.some(p=>p.answers[room.roundNo]&&normalize(p.answers[room.roundNo])===key)){ack?.({ok:false,error:'That word has already been used this round.'});return;}
    player.answers[room.roundNo]=word;room.lastActive=Date.now();ack?.({ok:true});pushState(room);
    if(room.players.every(p=>p.answers[room.roundNo]!==null))advanceAnswer(room);
  });
  socket.on('game:vote',(data={},ack)=>{
    const ref=socketsToPlayer.get(socket.id),room=ref&&rooms.get(ref.roomCode),player=room?.players.find(p=>p.token===ref.token);
    if(!room||!player||room.phase!=='vote'){ack?.({ok:false,error:'Voting is closed.'});return;}
    if(player.vote!==null){ack?.({ok:false,error:'Your vote is already locked in.'});return;}
    if(!room.players.some(p=>p.id===data.playerId)){ack?.({ok:false,error:'That player is not in this room.'});return;}
    player.vote=data.playerId;ack?.({ok:true});pushState(room);if(room.players.every(p=>p.vote!==null))resolveVote(room);
  });
  socket.on('game:guess',(data={},ack)=>{
    const ref=socketsToPlayer.get(socket.id),room=ref&&rooms.get(ref.roomCode),player=room?.players.find(p=>p.token===ref.token);
    if(!room||!player||room.phase!=='guess'){ack?.({ok:false,error:'The final guess is closed.'});return;}
    if(!room.caughtMoles.includes(player.id)){ack?.({ok:false,error:'Only a caught mole can make the final guess.'});return;}
    if(player.guessSubmitted){ack?.({ok:false,error:'Your guess is already locked in.'});return;}
    const word=String(data.word||'').trim().slice(0,70);if(!word){ack?.({ok:false,error:'Type your guess first.'});return;}
    player.guessSubmitted=true;ack?.({ok:true});finishRound(room,normalize(word)===normalize(room.secret.word),'guess');
  });
  socket.on('game:again',(data,ack)=>{
    const ref=socketsToPlayer.get(socket.id),room=ref&&rooms.get(ref.roomCode),player=room?.players.find(p=>p.token===ref.token);
    if(!room||!player||room.phase!=='result'){ack?.({ok:false,error:'This round is not finished yet.'});return;}
    if(room.hostToken!==player.token){ack?.({ok:false,error:'Only the host can start another round.'});return;}
    if(activePlayers(room).length<3){ack?.({ok:false,error:'At least 3 players must be connected.'});return;}
    retainConnectedPlayers(room);resetRound(room);ack?.({ok:true});
  });
  socket.on('room:leave',()=>{
    const ref=socketsToPlayer.get(socket.id),room=ref&&rooms.get(ref.roomCode),player=room?.players.find(p=>p.token===ref.token);
    if(room&&player){clearTimeout(player.removeTimer);removePlayer(room,player);}
    socketsToPlayer.delete(socket.id);socket.leave(ref?.roomCode||'');socket.emit('room:left');
  });
  socket.on('disconnect',()=>{
    const ref=socketsToPlayer.get(socket.id);socketsToPlayer.delete(socket.id);if(!ref)return;
    const room=rooms.get(ref.roomCode),player=room?.players.find(p=>p.token===ref.token);if(!player||player.socketId!==socket.id)return;
    player.connected=false;player.socketId=null;player.disconnectedAt=Date.now();room.lastActive=Date.now();
    if(room.phase==='answer'&&player.answers[room.roundNo]===null)player.answers[room.roundNo]='';
    pushState(room);
    if(room.phase==='answer'&&room.players.every(p=>p.answers[room.roundNo]!==null))advanceAnswer(room);
    player.removeTimer=setTimeout(()=>{const still=rooms.get(room.code)?.players.find(p=>p.token===player.token);if(still&&!still.connected)removePlayer(room,still);},60000);
  });
});

setInterval(()=>{const now=Date.now();for(const [key,room] of rooms){if(now-room.lastActive>ROOM_TTL){clearInterval(room.timer);rooms.delete(key);}}},60000).unref();
server.listen(PORT,'0.0.0.0',()=>console.log(`Suspect.io server listening on http://0.0.0.0:${PORT} (${wordBank.length.toLocaleString()} word entries)`));

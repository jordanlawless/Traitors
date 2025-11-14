// Traitors: Solo — client-side single-file app
(() => {
  // DOM
  const $ = id => document.getElementById(id);
  const logEl = $('log');

  // Game state
  let state = {
    players: [], // {id, name, isHuman, role: 'faithful'|'traitor', alive:true, suspicion:0}
    numPlayers: 6,
    round: 0,
    phase: 'lobby', // lobby, reveal, night, day, vote, ended
    revealIndex: 0,
    nightKill: null,
    history: []
  };

  // Helpers
  function randChoice(arr) { return arr[Math.floor(Math.random()*arr.length)]; }
  function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]] } return a }

  // AI behavior
  function pickNightTargetByTraitor(traitor, players){
    // traitor prefers highest-suspicion faithful, but with randomness
    const candidates = players.filter(p => p.alive && p.id !== traitor.id && p.role !== 'traitor');
    if(!candidates.length) return null;
    candidates.sort((a,b)=> (b.suspicion - a.suspicion) + (Math.random()-0.5));
    return candidates[0].id;
  }

  function npcVote(npc, players){
    // NPC chooses someone to vote for.
    // If npc is traitor: avoid voting fellow traitor unless pressured.
    // If npc is faithful: pick highest suspicion.
    const alive = players.filter(p=>p.alive && p.id !== npc.id);
    if(npc.role === 'traitor'){
      // prefer to vote for most-suspicious non-traitor, but sometimes vote random to look innocent
      const nonTraitors = alive.filter(p=>p.role !== 'traitor');
      if(nonTraitors.length===0) return randChoice(alive).id;
      // with 20% chance, random
      if(Math.random() < 0.2) return randChoice(nonTraitors).id;
      nonTraitors.sort((a,b)=> b.suspicion - a.suspicion);
      return nonTraitors[0].id;
    } else {
      // faithful: rely on suspicion but sometimes mistake
      alive.sort((a,b)=> b.suspicion - a.suspicion);
      // 70% pick top suspicion, 30% pick randomly among top 3
      if(Math.random() < 0.7) return (alive[0] ? alive[0].id : randChoice(alive).id);
      const top3 = alive.slice(0,3);
      return randChoice(top3).id;
    }
  }

  function log(msg){
    state.history.push(msg);
    logEl.innerText = msg + "\n" + logEl.innerText;
  }

  // UI render
  function renderPlayers(){
    const ul = $('playersList');
    ul.innerHTML = '';
    state.players.forEach(p=>{
      const li = document.createElement('li');
      li.className = 'playerItem';
      li.innerHTML = `<div><strong>${p.name}</strong> ${p.isHuman?'<span class="badge">You</span>':''}</div><div>${p.alive?'<span class="badge">Alive</span>':'<span class="badge">Out</span>'}</div>`;
      ul.appendChild(li);
    });
    $('aliveCount').innerText = state.players.filter(p=>p.alive).length + ' / ' + state.players.length;
  }

  function setPhase(phase){
    state.phase = phase;
    $('phaseLabel').innerText = phase;
  }

  // Game logic
  function setupGame(){
    const num = parseInt($('numPlayers').value,10) || 6;
    const name = $('playerName').value.trim() || 'You';
    state.numPlayers = Math.max(4, Math.min(8, num));
    // create players
    state.players = [];
    for(let i=0;i<state.numPlayers;i++){
      const isHuman = (i===0);
      const pname = isHuman ? name : (['Alex','Sam','Riley','Jordan','Taylor','Casey','Morgan','Jamie'][i] || ('NPC'+(i)));
      state.players.push({ id: 'p'+i, name: pname, isHuman, role: 'faithful', alive: true, suspicion: Math.random()*0.2 });
    }

    // assign traitors
    let nTraitors = 1;
    if(state.numPlayers <=5) nTraitors=1;
    else if(state.numPlayers <=8) nTraitors=2;
    else nTraitors=3;
    // pick traitor indices (not player 0 preferably, but allow)
    const indices = shuffle([...Array(state.numPlayers).keys()]);
    for(let i=0;i<nTraitors;i++){
      state.players[indices[i]].role = 'traitor';
    }

    // shuffle initial suspicion little
    state.players.forEach(p=> p.suspicion = Math.random()*0.2);

    state.round = 0;
    state.revealIndex = 0;
    state.nightKill = null;
    state.history = [];
    $('log').innerText = '';
    $('setup').style.display = 'none';
    $('roleReveal').style.display = '';
    $('gameUI').style.display = 'none';
    setPhase('reveal');
    renderPlayers();
    updateStatus();
    showRevealText();
  }

  function updateStatus(){
    $('roundNum').innerText = state.round;
    renderPlayers();
  }

  function showRevealText(){
    const idx = state.revealIndex;
    const p = state.players[idx];
    if(!p) { // finished reveal
      $('roleReveal').style.display = 'none';
      $('gameUI').style.display = '';
      startNight();
      return;
    }
    const txt = p.isHuman ? `Hello ${p.name}. Your role is: ` : `Pass the device to ${p.name}.`;
    const roleText = p.isHuman ? (p.role === 'traitor' ? '<b style="color:#d33">TRAITOR</b>' : '<b>FAITHFUL</b>') : '<i>Secret</i>';
    $('revealText').innerHTML = `<p>${txt}</p><p style="font-size:18px">${roleText}</p><p class="muted">Press Next when ready to pass device.</p>`;
  }

  // Reveal Next button
  $('revealNext').addEventListener('click', ()=>{
    state.revealIndex++;
    // skip non-human reveals: actually we show each player one by one, including NPCs with instruction
    showRevealText();
  });

  // Start night
  function startNight(){
    state.round++;
    setPhase('night');
    state.nightKill = null;
    log(`--- Night ${state.round} begins ---`);
    // Traitros choose targets secretly; we simulate by having each traitor pick a target
    const traitors = state.players.filter(p=>p.alive && p.role==='traitor');
    if(traitors.length === 0){
      checkWin();
      return;
    }
    // each traitor picks
    const choices = [];
    traitors.forEach(t=>{
      const choice = pickNightTargetByTraitor(t, state.players);
      if(choice) choices.push(choice);
      log(`${t.name} (traitor) is choosing...`);
    });
    // resolve majority
    if(choices.length === 0){
      log('No valid targets.');
      setTimeout(()=> startDay(), 800);
      return;
    }
    const tally = {};
    choices.forEach(c=> tally[c] = (tally[c]||0)+1);
    // find max
    let max = 0; let winners = [];
    Object.keys(tally).forEach(k=>{
      if(tally[k] > max){ max = tally[k]; winners=[k]; }
      else if(tally[k] === max) winners.push(k);
    });
    const targetId = winners[Math.floor(Math.random()*winners.length)];
    // kill victim
    const victim = state.players.find(p=>p.id===targetId);
    if(victim){
      victim.alive = false;
      state.nightKill = victim;
      log(`${victim.name} was killed during the night.`);
      // increase suspicion on whoever scored highest? Slightly increase suspicion on randoms to mix behaviour
      state.players.forEach(p=> {
        if(p.alive) p.suspicion += (Math.random()*0.08);
      });
      // traitors lower suspicion slightly
      state.players.filter(p=>p.role==='traitor').forEach(t=> t.suspicion = Math.max(0, t.suspicion - 0.05));
    }
    setTimeout(()=> startDay(), 900);
  }

  function startDay(){
    setPhase('day');
    log(`--- Day ${state.round} begins ---`);
    if(state.nightKill){
      log(`During the night, ${state.nightKill.name} was killed.`);
    } else {
      log('No one was killed last night.');
    }
    updateStatus();
    // After a short 'discussion' period, proceed to voting UI
    renderActionAreaForDiscussion();
  }

  function renderActionAreaForDiscussion(){
    const area = $('actionArea');
    area.innerHTML = '';
    const p = document.createElement('div');
    p.innerHTML = `<p>Discuss (simulated) — press 'Start Vote' when ready.</p>`;
    const btn = document.createElement('button');
    btn.textContent = 'Start Vote';
    btn.className = 'primary';
    btn.onclick = ()=> startVote();
    area.appendChild(p);
    area.appendChild(btn);
  }

  function startVote(){
    setPhase('vote');
    log('Voting begins.');
    // Each alive player (in seat order) casts a vote. If human, show UI to choose.
    conductVotesSequentially(0);
  }

  function conductVotesSequentially(index){
    const alive = state.players.filter(p=>p.alive);
    if(index >= alive.length){
      // tally votes
      finalizeVotes();
      return;
    }
    const voter = alive[index];
    if(voter.isHuman){
      renderVoteUIForHuman(voter, () => {
        // after vote, continue
        conductVotesSequentially(index+1);
      });
    } else {
      // NPC votes immediately
      const choiceId = npcVote(voter, state.players);
      voter.lastVote = choiceId;
      log(`${voter.name} votes.`);
      // small dynamic: increase suspicion of voted target slightly
      const target = state.players.find(p=>p.id===choiceId);
      if(target) target.suspicion += 0.06;
      setTimeout(()=> conductVotesSequentially(index+1), 400);
    }
  }

  function renderVoteUIForHuman(voter, cb){
    const area = $('actionArea');
    area.innerHTML = `<div><p>Your turn to vote, ${voter.name}.</p></div>`;
    const alive = state.players.filter(p=>p.alive && p.id !== voter.id);
    alive.forEach(t=>{
      const b = document.createElement('button');
      b.className = 'smallBtn';
      b.textContent = 'Vote ' + t.name;
      b.onclick = ()=>{
        voter.lastVote = t.id;
        // increase suspicion slightly
        t.suspicion += 0.08;
        log(`${voter.name} votes for ${t.name}.`);
        cb();
      };
      area.appendChild(b);
    });
  }

  function finalizeVotes(){
    // collect votes from alive players (lastVote property)
    const votes = {};
    state.players.filter(p=>p.alive).forEach(p=>{
      const v = p.lastVote;
      if(v) votes[v] = (votes[v]||0) + 1;
    });
    if(Object.keys(votes).length === 0){
      log('No votes cast — no elimination.');
      // next night
      setTimeout(()=> {
        clearVotes();
        checkWin() || startNight();
      }, 800);
      return;
    }
    let max = 0; let winners = [];
    Object.keys(votes).forEach(k=>{
      if(votes[k] > max){ max = votes[k]; winners = [k]; }
      else if(votes[k] === max) winners.push(k);
    });
    const eliminatedId = winners[Math.floor(Math.random()*winners.length)];
    const eliminated = state.players.find(p=>p.id===eliminatedId);
    if(eliminated){
      eliminated.alive = false;
      log(`${eliminated.name} was banished by vote.`);
      // increase suspicion adjustments
      state.players.forEach(p=> p.suspicion += Math.random()*0.02);
    }
    // clear votes and continue
    setTimeout(()=> {
      clearVotes();
      updateStatus();
      if(!checkWin()) startNight();
    }, 900);
  }

  function clearVotes(){
    state.players.forEach(p=> p.lastVote = null);
  }

  function checkWin(){
    const traitorsAlive = state.players.filter(p=>p.alive && p.role==='traitor').length;
    const faithfulAlive = state.players.filter(p=>p.alive && p.role!=='traitor').length;
    if(traitorsAlive === 0){
      endGame('Faithfuls win', 'All traitors have been eliminated. You win!');
      return true;
    }
    if(traitorsAlive >= faithfulAlive){
      endGame('Traitors win', 'The traitors are now equal or greater. Traitors win.');
      return true;
    }
    return false;
  }

  function endGame(title, text){
    setPhase('ended');
    $('gameUI').style.display = 'none';
    $('endCard').style.display = '';
    $('endTitle').innerText = title;
    $('endText').innerText = text;
    log('--- Game Over ---\n' + title + ' - ' + text);
  }

  // UI events
  $('startBtn').addEventListener('click', ()=>{
    setupGame();
  });

  $('restartBtn').addEventListener('click', ()=>{
    $('endCard').style.display = 'none';
    $('setup').style.display = '';
    $('gameUI').style.display = 'none';
    setPhase('lobby');
  });

  $('clearLog').addEventListener('click', ()=> { $('log').innerText=''; state.history=[]; });

  // initial
  function init(){
    setPhase('lobby');
    $('aliveCount').innerText = '0';
  }

  init();

})();

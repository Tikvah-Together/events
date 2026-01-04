export default function LiveRoundView({ event, user, attendees }) {
  const [now, setNow] = useState(new Date());

  // Update the clock every second
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!event.startTime) return <div>Waiting for start...</div>;

  // --- THE MATH ---
  const startTime = event.startTime.toDate(); // Convert Firebase timestamp
  const secondsSinceStart = Math.floor((now - startTime) / 1000);
  
  const roundLengthPlusMove = (event.roundTime * 60) + 60; // e.g., 7 mins + 1 min move
  const currentRound = Math.floor(secondsSinceStart / roundLengthPlusMove) + 1;
  const timeInCurrentBlock = secondsSinceStart % roundLengthPlusMove;
  
  // Decide if we are in the "Dating" phase or the "Moving" phase
  const isMoving = timeInCurrentBlock < 60; // First 60 seconds is for moving
  const secondsLeft = isMoving 
    ? 60 - timeInCurrentBlock 
    : roundLengthPlusMove - timeInCurrentBlock;

  // Calculate Table Rotation
  const totalTables = event.totalTables || 1;
  const myStartTable = user.tableNumber || 1;
  let currentTable = myStartTable;

  if (user.gender === 'man') {
    currentTable = ((myStartTable + currentRound - 2) % totalTables) + 1;
  }

  // Find Partner
  const partner = attendees.find(a => 
    a.gender !== user.gender && 
    (user.gender === 'woman' 
      ? (((a.tableNumber + currentRound - 2) % totalTables) + 1 === currentTable)
      : (a.tableNumber === currentTable))
  );

  // --- THE UI ---
  if (isMoving) {
    return (
      <div className="min-h-screen bg-orange-600 flex flex-col items-center justify-center text-white">
        <h1 className="text-5xl font-black mb-4">MOVE TO TABLE</h1>
        <div className="bg-white text-orange-600 rounded-full w-48 h-48 flex items-center justify-center text-9xl font-black shadow-2xl">
          {currentTable}
        </div>
        <p className="mt-8 text-2xl font-bold">Next round starts in {secondsLeft}s</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-6 text-center">
      <div className="absolute top-10 right-10 text-slate-300 font-mono text-xl">
        {Math.floor(secondsLeft / 60)}:{(secondsLeft % 60).toString().padStart(2, '0')}
      </div>
      <p className="text-blue-600 font-black tracking-widest uppercase">Round {currentRound} • Table {currentTable}</p>
      <h2 className="text-6xl font-black mt-4 mb-2">{partner?.name || "No Date"}</h2>
      <p className="text-2xl text-slate-500 mb-10">{partner?.subGroup}</p>
      
      {/* Selection Buttons (Yes/No) here */}
      <div className="flex gap-10">
         <button className="p-10 bg-slate-100 rounded-3xl text-4xl">✕</button>
         <button className="p-10 bg-pink-100 rounded-3xl text-4xl">♥</button>
      </div>
    </div>
  );
}
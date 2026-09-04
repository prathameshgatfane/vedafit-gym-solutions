type AppProps = {
  apiUrl: string;
};

function App({ apiUrl }: AppProps) {
  return (
    <main>
      <h1>Gym Management — Admin</h1>
      <p>Phase 0 scaffold. API base URL: {apiUrl}</p>
    </main>
  );
}

export default App;

import Navbar from '../components/Navbar';

export default function LiveTV() {
  return (
    <div className="app-layout">
      <Navbar />
      <div className="livetv-pluto-wrap">
        <iframe
          src="https://pluto.tv/en/live-tv"
          className="livetv-pluto-frame"
          allowFullScreen
          allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
          referrerPolicy="no-referrer-when-downgrade"
          title="Pluto TV Live"
        />
      </div>
    </div>
  );
}

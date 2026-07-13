import { PRESET_AVATARS } from '../utils/presetAvatars';

export default function AvatarPresetPicker({ selected, onSelect, disabled = false }) {
  return (
    <div className="avatar-preset-grid" role="group" aria-label="Preset avatars">
      {PRESET_AVATARS.map((preset) => (
        <button
          key={preset.id}
          type="button"
          className={`avatar-preset-btn${selected === preset.url ? ' active' : ''}`}
          onClick={() => onSelect(preset.url)}
          disabled={disabled}
          aria-pressed={selected === preset.url}
          title="Use this avatar"
        >
          <img src={preset.url} alt="" />
        </button>
      ))}
    </div>
  );
}

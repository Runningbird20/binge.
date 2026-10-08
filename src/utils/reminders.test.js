import { reminderPresets } from './reminders';

jest.mock('./supabase', () => ({ supabase: null, isSupabaseConfigured: false }));

describe('reminderPresets', () => {
  it('offers tonight at 8 during the day', () => {
    const presets = reminderPresets(new Date(2026, 9, 7, 14, 0)); // Wed 2pm
    expect(presets[0]).toMatchObject({ id: 'tonight' });
    expect(presets[0].when.getHours()).toBe(20);
    expect(presets[1].when.getDate()).toBe(8);
    expect(presets[2].when.getDay()).toBe(6);
  });

  it('falls back to two hours from now late in the evening', () => {
    const now = new Date(2026, 9, 7, 19, 50);
    const [first] = reminderPresets(now);
    expect(first.id).toBe('later');
    expect(first.when - now).toBe(2 * 3600 * 1000);
  });

  it('never picks today for Saturday when it is already Saturday', () => {
    const saturday = new Date(2026, 9, 10, 9, 0);
    const weekend = reminderPresets(saturday).find((preset) => preset.id === 'weekend');
    expect(weekend.when.getDate()).toBe(17);
  });
});

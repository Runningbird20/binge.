import Testing
@testable import BingeTV

@Suite struct SmokeTests {
    @Test func configIsLoaded() {
        #expect(Config.isConfigured)
    }
}
